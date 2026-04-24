import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService, type CalculatedProduct, type CalculatorInput } from '../calculator/calculator.service';
import { ClassifierService, type ProductRow } from '../classifier/classifier.service';
import { errMsg } from '../common/errors';
import { defaultCountryWarningNote, type ProductNote } from '../common/product-notes';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { KNOWN_CURRENCIES } from '../common/normalize-impedi';
import { DEFAULT_COUNTRY_OF_ORIGIN, Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import {
  buildDocumentNotificationPayload,
  type DocumentNotification,
} from './notification';

export type { DocumentNotification };

@Processor('document-processing')
export class DocumentsProcessor extends WorkerHost {
  private logger = new Logger(DocumentsProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-notifications') private notificationQueue: Queue,
    private classifier: ClassifierService,
    private calculator: CalculatorService,
    private configService: CalculationConfigService,
    private dutyInterpreter: DutyInterpreterService,
    private currencyService: CurrencyService,
    private calculationLogs: CalculationLogsService,
    private audit: PipelineAuditService,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    if (job.name === 'recalculate-document') {
      return this.recalculate(job.data.documentId);
    }

    const { documentId } = job.data;
    this.logger.log(`Processing document ${documentId}`);

    const doc = await this.repo.findOne({
      where: { id: documentId },
      relations: ['telegramUser'],
    });
    if (!doc) {
      this.logger.warn(`Document ${documentId} not found`);
      return;
    }

    doc.status = DocumentStatus.PROCESSING;
    await this.repo.save(doc);

    const attempt = (job.attemptsMade ?? 0) + 1;
    let currentStageRunId: string | null = null;

    try {
      const rows: ProductRow[] = (doc.parsedData ?? []).map((row) => ({
        description: String(row.description ?? ''),
        quantity: Number(row.quantity) || 1,
        price: Number(row.price) || 0,
        weight: Number(row.weight) || 0,
        dimensions: this.extractDimensions(row),
        notes: [],
        ...(typeof row.hsCode === 'string' && row.hsCode ? { hsCode: row.hsCode } : {}),
        ...(typeof row.rawContext === 'string' && row.rawContext ? { rawContext: row.rawContext } : {}),
      }));

      this.logger.log(`Document ${documentId}: ${rows.length} rows, currency=${doc.currency || 'USD'}`);

      const currency = (doc.currency || 'USD').toUpperCase();
      const [config, currencyToDoc] = await Promise.all([
        this.configService.get(),
        this.buildCurrencyToDocRates(currency),
      ]);
      const {
        pricePercent,
        weightRate,
        fixedFee,
        sendResultFile,
        confidenceThreshold,
        lowConfidenceAction,
      } = config;
      const commission = { pricePercent, weightRate, fixedFee };
      this.logger.log(`Document ${documentId}: currency=${currency}, currencyToDoc=${JSON.stringify(currencyToDoc)}`);

      const language = doc.language ?? doc.telegramUser?.language;

      currentStageRunId = await this.audit.startStageRun({
        documentId,
        stage: 'classify',
        attempt,
        metadata: { rows: rows.length, language: language ?? null, confidenceThreshold },
      });
      const t0 = Date.now();
      const classifyResult = await this.classifier.classify(
        rows,
        language,
        confidenceThreshold,
        { documentId, stageRunId: currentStageRunId },
      );
      const classified = classifyResult.products;
      doc.tokenUsage = addStageUsage(doc.tokenUsage ?? {}, 'classifier', classifyResult.tokenUsage);
      this.logger.log(`Document ${documentId}: classification done in ${Date.now() - t0}ms`);
      void this.audit.completeStageRun(currentStageRunId, {
        output: {
          products: classified,
          searchQueries: classifyResult.audit.searchQueries,
          tksCandidates: classifyResult.audit.tksCandidates,
          selections: classifyResult.audit.selections,
        },
        tokenUsage: classifyResult.tokenUsage,
        partial: classifyResult.usedFallback,
      });
      currentStageRunId = null;

      currentStageRunId = await this.audit.startStageRun({
        documentId,
        stage: 'interpret',
        attempt,
        metadata: {
          uniqueCodes: new Set(classified.map((c) => c.tnVedCode).filter(Boolean)).size,
          language: language ?? null,
        },
      });
      const t1 = Date.now();
      const interpretResult = await this.dutyInterpreter.interpret(classified, language, {
        documentId,
        stageRunId: currentStageRunId,
      });
      const interpreted = interpretResult.products;
      doc.tokenUsage = addStageUsage(doc.tokenUsage, 'interpreter', interpretResult.tokenUsage);
      this.logger.log(`Document ${documentId}: interpretation done in ${Date.now() - t1}ms`);
      void this.audit.completeStageRun(currentStageRunId, {
        output: {
          interpretationsByCode: Object.fromEntries(
            interpreted
              .filter((p) => p.dutyInterpretation && p.tnVedCode)
              .map((p) => [p.tnVedCode, p.dutyInterpretation]),
          ),
        },
        tokenUsage: interpretResult.tokenUsage,
        partial: interpretResult.usedFallback,
      });
      currentStageRunId = null;

      if (!doc.countryOfOrigin) {
        doc.countryOfOrigin = DEFAULT_COUNTRY_OF_ORIGIN;
        doc.countryOriginSource = 'default';
        doc.countryDetectionReason = 'Страна происхождения не определена, применён Китай по умолчанию';
      }
      if (doc.countryOriginSource === 'default') {
        for (const p of interpreted) p.notes.push(defaultCountryWarningNote());
      }

      currentStageRunId = await this.audit.startStageRun({
        documentId,
        stage: 'calculate',
        attempt,
        metadata: {
          rows: interpreted.length,
          currency,
          countryOfOrigin: doc.countryOfOrigin,
          confidenceThreshold,
          commission,
          currencyToDoc,
        },
      });
      const t2 = Date.now();
      const summary = this.calculator.calculate(interpreted, commission, {
        currencyToDoc,
        confidenceThreshold,
        countryOfOrigin: doc.countryOfOrigin,
      });
      this.logger.log(`Document ${documentId}: calculation done in ${Date.now() - t2}ms`);

      const needsConversion = currency !== 'RUB';
      let exchangeRate = 1;
      if (needsConversion) {
        exchangeRate = await this.currencyService.getRate(currency);
      }
      const toRub = (v: number) => this.currencyService.toRubSync(v, exchangeRate);

      // Store display exchange rates (1 unit = X RUB) for currency selector in admin
      const ratesMap: Record<string, number> = { RUB: 1 };
      for (const cur of ['USD', 'EUR', 'CNY', 'INR']) {
        if (cur in ratesMap) continue;
        try {
          ratesMap[cur] = await this.currencyService.getRate(cur);
        } catch { /* skip unavailable */ }
      }
      doc.exchangeRates = ratesMap;

      doc.resultData = summary.items.map((item, i) => {
        item.notes.push(this.buildBreakdownNote(item, currency, needsConversion ? exchangeRate : null));
        const base = {
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          weight: item.weight,
          dimensions: item.dimensions ?? null,
          tnVedCode: item.tnVedCode,
          tnVedDescription: item.tnVedDescription,
          dutyRate: item.dutyRate,
          dutyRateUnit: item.dutyRateUnit,
          dutySign: item.dutySign,
          dutyMin: item.dutyMin,
          dutyMinUnit: item.dutyMinUnit,
          dutyRateDisplay: item.dutyRateDisplay,
          vatRate: item.vatRate,
          exciseRate: item.exciseRate,
          matched: item.matched,
          suggestedCode: item.suggestedCode,
          // Сохраняем, чтобы recalculate мог пересчитать с другой страной без Claude.
          dutyInterpretation: interpreted[i]?.dutyInterpretation ?? null,
          totalPrice: item.totalPrice,
          dutyAmount: item.dutyAmount,
          dutyAmountIsEstimate: item.dutyAmountIsEstimate,
          dutyFormula: item.dutyFormula,
          dutyBase: item.dutyBase,
          vatAmount: item.vatAmount,
          exciseAmount: item.exciseAmount,
          logisticsCommission: item.logisticsCommission,
          totalCost: item.totalCost,
          verificationStatus: item.verificationStatus, // устаревшее, для BC
          calculationStatus: item.calculationStatus,
          matchConfidence: item.matchConfidence,
          verified: classified[i]?.verified ?? false,
          verificationComment: classified[i]?.verificationComment ?? null,
          notes: item.notes,
        };
        if (!needsConversion) return base;
        return {
          ...base,
          totalPriceRub: toRub(item.totalPrice),
          dutyAmountRub: toRub(item.dutyAmount),
          vatAmountRub: toRub(item.vatAmount),
          exciseAmountRub: toRub(item.exciseAmount),
          logisticsCommissionRub: toRub(item.logisticsCommission),
          totalCostRub: toRub(item.totalCost),
          exchangeRate,
        };
      });
      let hasRowErrors = false;
      const lowConfidenceReasons: string[] = [];
      for (let i = 0; i < summary.items.length; i++) {
        const item = summary.items[i];
        if (item.calculationStatus === 'error') hasRowErrors = true;
        if (!item.matched || item.matchConfidence < confidenceThreshold) {
          lowConfidenceReasons.push(this.formatLowConfidenceReason(i, item, confidenceThreshold));
        }
      }

      void this.audit.completeStageRun(currentStageRunId, {
        output: {
          grandTotal: summary.grandTotal,
          totalDuty: summary.totalDuty,
          totalVat: summary.totalVat,
          totalExcise: summary.totalExcise,
          totalLogistics: summary.totalLogistics,
          items: summary.items,
          exchangeRates: doc.exchangeRates,
          exchangeRate: needsConversion ? exchangeRate : null,
          hasRowErrors,
          lowConfidenceReasons,
        },
        partial: summary.usedFallback,
      });
      currentStageRunId = null;

      if (lowConfidenceReasons.length > 0) {
        doc.rejectionReasons = lowConfidenceReasons;
        if (lowConfidenceAction === 'reject') {
          doc.status = DocumentStatus.REJECTED;
          await this.repo.save(doc);
          await this.notify({ doc, status: 'rejected', rejectionReasons: lowConfidenceReasons });
        } else {
          doc.status = DocumentStatus.CODE_REVIEW_REQUIRED;
          await this.repo.save(doc);
          await this.notify({ doc, status: 'code_review_required' });
        }
      } else {
        doc.status = hasRowErrors
          ? DocumentStatus.PROCESSED_WITH_ERRORS
          : DocumentStatus.PROCESSED;
        await this.repo.save(doc);
        await this.notify({
          doc,
          status: hasRowErrors ? 'processed_with_errors' : 'processed',
          sendResultFile,
        });
      }

      this.calculationLogs
        .create({
          documentId: doc.id,
          telegramUserId: doc.telegramUser?.telegramId ?? null,
          telegramUsername: doc.telegramUser?.username ?? null,
          fileName: doc.originalFileName,
          itemsCount: rows.length,
          trigger: 'full',
          resultSummary: {
            grandTotal: summary.grandTotal,
            totalDuty: summary.totalDuty,
            totalVat: summary.totalVat,
            totalExcise: summary.totalExcise,
            totalLogistics: summary.totalLogistics,
            currency: currency,
          },
        })
        .catch((err) => {
          this.logger.warn(`Failed to write calculation log for ${documentId}`, err);
        });
      this.logger.log(
        `Document ${documentId} processed: ${rows.length} rows, grandTotal=${summary.grandTotal}`,
      );
    } catch (err) {
      if (currentStageRunId) {
        void this.audit.failStageRun(currentStageRunId, err);
      }
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = errMsg(err) || 'Unknown error';
      await this.repo.save(doc);
      await this.notify({ doc, status: 'failed', errorMessage: doc.errorMessage ?? undefined });
      this.logger.error(
        `Document ${documentId} processing failed: ${doc.errorMessage}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /**
   * Быстрый пересчёт уже обработанного документа с актуальной страной происхождения.
   * Переиспользует сохранённые charges (dutyInterpretation из resultData) — AI не зовётся.
   * Если в resultData нет dutyInterpretation (старые документы), просто пересчитывает
   * по базовым полям TKS, которые тоже сохранены.
   */
  async recalculate(documentId: string): Promise<void> {
    this.logger.log(`Recalculating document ${documentId}`);
    const doc = await this.repo.findOne({
      where: { id: documentId },
      relations: ['telegramUser'],
    });
    if (!doc) {
      this.logger.warn(`Document ${documentId} not found`);
      return;
    }
    if (!doc.resultData || doc.resultData.length === 0) {
      this.logger.warn(`Document ${documentId}: no resultData, can't recalculate — run full reprocess`);
      return;
    }

    doc.status = DocumentStatus.PROCESSING;
    await this.repo.save(doc);

    const stageRunId = await this.audit.startStageRun({
      documentId,
      stage: 'calculate',
      metadata: {
        trigger: 'recalculate',
        countryOfOrigin: doc.countryOfOrigin,
      },
    });

    try {
      const currency = (doc.currency || 'USD').toUpperCase();
      const [config, currencyToDoc] = await Promise.all([
        this.configService.get(),
        this.buildCurrencyToDocRates(currency),
      ]);
      const { pricePercent, weightRate, fixedFee, sendResultFile, confidenceThreshold } = config;
      const commission = { pricePercent, weightRate, fixedFee };

      // Сохраняем classify/interpret notes — они стабильны при смене страны; calculate
      // notes пересоздадим (breakdown, warning про default) ниже.
      const inputs: CalculatorInput[] = doc.resultData.map((r) => {
        const row = r as Record<string, unknown>;
        const notes = Array.isArray(row.notes)
          ? (row.notes as ProductNote[]).filter((n) => n.stage !== 'calculate')
          : [];
        return {
          description: String(row.description ?? ''),
          quantity: Number(row.quantity) || 1,
          price: Number(row.price) || 0,
          weight: Number(row.weight) || 0,
          dimensions: (row.dimensions as Dimension[] | null) ?? undefined,
          tnVedCode: String(row.tnVedCode ?? ''),
          tnVedDescription: String(row.tnVedDescription ?? ''),
          dutyRate: Number(row.dutyRate) || 0,
          dutyRateUnit: (row.dutyRateUnit as string | null) ?? null,
          dutySign: (row.dutySign as string | null) ?? null,
          dutyMin: (row.dutyMin as number | null) ?? null,
          dutyMinUnit: (row.dutyMinUnit as string | null) ?? null,
          vatRate: Number(row.vatRate) || 0,
          exciseRate: Number(row.exciseRate) || 0,
          matchConfidence: Number(row.matchConfidence) || 0,
          matched: Boolean(row.matched ?? true),
          verified: Boolean(row.verified ?? false),
          suggestedCode: (row.suggestedCode as string | null) ?? null,
          verificationComment: String(row.verificationComment ?? ''),
          notes,
          dutyInterpretation: (row.dutyInterpretation as CalculatorInput['dutyInterpretation']) ?? null,
        };
      });

      if (doc.countryOriginSource === 'default') {
        for (const p of inputs) p.notes.push(defaultCountryWarningNote());
      }

      const summary = this.calculator.calculate(inputs, commission, {
        currencyToDoc,
        confidenceThreshold,
        countryOfOrigin: doc.countryOfOrigin,
      });

      const needsConversion = currency !== 'RUB';
      let exchangeRate = 1;
      if (needsConversion) exchangeRate = await this.currencyService.getRate(currency);
      const toRub = (v: number) => this.currencyService.toRubSync(v, exchangeRate);

      doc.resultData = summary.items.map((item, i) => {
        item.notes.push(this.buildBreakdownNote(item, currency, needsConversion ? exchangeRate : null));
        const prev = doc.resultData![i] as Record<string, unknown>;
        const base = {
          ...prev,
          dutyRate: item.dutyRate,
          dutyRateDisplay: item.dutyRateDisplay,
          totalPrice: item.totalPrice,
          dutyAmount: item.dutyAmount,
          dutyAmountIsEstimate: item.dutyAmountIsEstimate,
          dutyFormula: item.dutyFormula,
          dutyBase: item.dutyBase,
          vatAmount: item.vatAmount,
          exciseAmount: item.exciseAmount,
          logisticsCommission: item.logisticsCommission,
          totalCost: item.totalCost,
          verificationStatus: item.verificationStatus,
          calculationStatus: item.calculationStatus,
          notes: item.notes,
        };
        if (!needsConversion) return base;
        return {
          ...base,
          totalPriceRub: toRub(item.totalPrice),
          dutyAmountRub: toRub(item.dutyAmount),
          vatAmountRub: toRub(item.vatAmount),
          exciseAmountRub: toRub(item.exciseAmount),
          logisticsCommissionRub: toRub(item.logisticsCommission),
          totalCostRub: toRub(item.totalCost),
          exchangeRate,
        };
      });

      const hasRowErrors = summary.items.some((i) => i.calculationStatus === 'error');

      void this.audit.completeStageRun(stageRunId, {
        output: {
          grandTotal: summary.grandTotal,
          totalDuty: summary.totalDuty,
          totalVat: summary.totalVat,
          totalExcise: summary.totalExcise,
          totalLogistics: summary.totalLogistics,
          items: summary.items,
          exchangeRate: needsConversion ? exchangeRate : null,
          hasRowErrors,
        },
        partial: summary.usedFallback,
      });

      doc.status = hasRowErrors ? DocumentStatus.PROCESSED_WITH_ERRORS : DocumentStatus.PROCESSED;
      await this.repo.save(doc);
      await this.notify({
        doc,
        status: hasRowErrors ? 'processed_with_errors' : 'processed',
        sendResultFile,
      });

      this.calculationLogs
        .create({
          documentId: doc.id,
          telegramUserId: doc.telegramUser?.telegramId ?? null,
          telegramUsername: doc.telegramUser?.username ?? null,
          fileName: doc.originalFileName,
          itemsCount: inputs.length,
          trigger: 'recalculate',
          resultSummary: {
            grandTotal: summary.grandTotal,
            totalDuty: summary.totalDuty,
            totalVat: summary.totalVat,
            totalExcise: summary.totalExcise,
            totalLogistics: summary.totalLogistics,
            currency,
          },
        })
        .catch((err) => this.logger.warn(`Failed to write calculation log for ${documentId}`, err));
      this.logger.log(
        `Document ${documentId} recalculated: ${inputs.length} rows, grandTotal=${summary.grandTotal}, country=${doc.countryOfOrigin}`,
      );
    } catch (err) {
      void this.audit.failStageRun(stageRunId, err);
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = errMsg(err) || 'Recalculation error';
      await this.repo.save(doc);
      this.logger.error(
        `Document ${documentId} recalculation failed: ${doc.errorMessage}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /**
   * Собирает курсы всех валют, в которых TKS выдаёт specific-ставки,
   * выраженные в единицах валюты документа. Недоступные в ЦБ РФ валюты пропускаются —
   * для них ставки будут помечены estimated с blocker-note.
   */
  private async buildCurrencyToDocRates(docCurrency: string): Promise<Record<string, number>> {
    const targets = Array.from(new Set([docCurrency, ...KNOWN_CURRENCIES]));
    const fetched = await Promise.all(
      targets.map(async (c) => {
        if (c === 'RUB') return [c, 1] as const;
        try {
          return [c, await this.currencyService.getRate(c)] as const;
        } catch {
          return [c, null] as const;
        }
      }),
    );
    const rubPerUnit = Object.fromEntries(fetched.filter((e) => e[1] != null)) as Record<string, number>;

    const docInRub = rubPerUnit[docCurrency];
    if (docInRub == null) {
      this.logger.warn(`Rate for document currency ${docCurrency} unavailable — only ad valorem duties will be exact`);
      return { [docCurrency]: 1 };
    }

    const rates: Record<string, number> = { [docCurrency]: 1 };
    for (const [c, rub] of Object.entries(rubPerUnit)) {
      if (c === docCurrency) continue;
      const r = rub / docInRub;
      if (Number.isFinite(r) && r > 0) rates[c] = r;
    }
    return rates;
  }

  private buildBreakdownNote(
    item: CalculatedProduct,
    currency: string,
    exchangeRate: number | null,
  ): ProductNote {
    const fmt = (v: number) => `${v.toFixed(2)} ${currency}`;
    const parts: string[] = [`${fmt(item.totalPrice)} (сумма)`];

    if (item.dutyAmount > 0 || item.dutyAmountIsEstimate) {
      const rateLabel = item.dutyRateDisplay && item.dutyRateDisplay !== '—' ? `, ${item.dutyRateDisplay}` : '';
      parts.push(`${fmt(item.dutyAmount)} (пошлина${rateLabel})`);
    }

    if (item.exciseAmount > 0) {
      parts.push(`${fmt(item.exciseAmount)} (акциз ${item.exciseRate}%)`);
    }

    if (item.vatAmount > 0) {
      parts.push(`${fmt(item.vatAmount)} (НДС ${item.vatRate}%)`);
    }

    if (item.logisticsCommission > 0) {
      parts.push(`${fmt(item.logisticsCommission)} (комиссия)`);
    }

    let message = `Расчёт: ${parts.join(' + ')} = ${fmt(item.totalCost)}`;
    if (exchangeRate && exchangeRate !== 1) {
      message += ` → ${(item.totalCost * exchangeRate).toFixed(2)} RUB (курс ×${exchangeRate.toFixed(2)})`;
    }

    return {
      stage: 'calculate',
      severity: 'info',
      field: 'total',
      message,
    };
  }

  private extractDimensions(row: Record<string, unknown>): Dimension[] | undefined {
    const raw = row.dimensions;
    if (!Array.isArray(raw)) return undefined;
    const result: Dimension[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name : null;
      const unit = typeof obj.unit === 'string' ? obj.unit : null;
      const value = Number(obj.value);
      if (!name || !unit || !Number.isFinite(value)) continue;
      result.push({ name, value, unit });
    }
    return result.length > 0 ? result : undefined;
  }

  private async notify(opts: {
    doc: Document;
    status: DocumentNotification['status'];
    errorMessage?: string;
    sendResultFile?: boolean;
    rejectionReasons?: string[];
  }): Promise<void> {
    const payload = buildDocumentNotificationPayload(opts.doc, opts.status, {
      errorMessage: opts.errorMessage,
      rejectionReasons: opts.rejectionReasons,
      sendResultFile: opts.sendResultFile,
    });
    if (!payload) return;

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${opts.doc.id}`, err);
    });
  }

  private formatLowConfidenceReason(
    idx: number,
    item: { description: string; tnVedCode?: string; matchConfidence: number; matched: boolean },
    threshold: number,
  ): string {
    const row = idx + 1;
    const desc = item.description || '—';
    if (!item.matched) {
      return `Строка ${row}: «${desc}» — код ТН ВЭД не определён (ниже порога ${threshold.toFixed(2)}).`;
    }
    const code = item.tnVedCode || '—';
    const conf = item.matchConfidence.toFixed(2);
    return `Строка ${row}: «${desc}» — код ${code}, уверенность ${conf} (ниже порога ${threshold.toFixed(2)}).`;
  }
}
