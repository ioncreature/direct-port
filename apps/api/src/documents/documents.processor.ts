import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService, type CalculatedProduct, type CalculatorInput } from '../calculator/calculator.service';
import { ClassifierService, type ProductRow } from '../classifier/classifier.service';
import { ErrorCode } from '../common/error-codes';
import { classifyPipelineError, errMsg } from '../common/errors';
import { computeWeightDenominator, resolveFreightTotalInDocCurrency } from '../common/freight';
import { defaultCountryWarningNote, type ProductNote } from '../common/product-notes';
import {
  type RejectionReasonData,
  formatRejectionReason,
  localizeRejectionReasonsForUser,
} from '../common/rejection-reasons';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { KNOWN_CURRENCIES } from '../common/normalize-impedi';
import { buildResultRow } from './result-row.helper';
import { DEFAULT_COUNTRY_OF_ORIGIN, Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import {
  buildDocumentNotificationPayload,
  extractProblemRows,
  type DocumentNotification,
  type ProblemRowSummary,
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
    private regulatoryService: RegulatoryRequirementsService,
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
        this.currencyService.buildCurrencyToDocRates(currency, KNOWN_CURRENCIES),
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

      const freight = this.buildFreightOption(doc, interpreted, currencyToDoc);
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
          freight: doc.freightCost
            ? { cost: doc.freightCost, currency: doc.freightCurrency }
            : null,
        },
      });
      const t2 = Date.now();
      const summary = this.calculator.calculate(interpreted, commission, {
        currencyToDoc,
        confidenceThreshold,
        countryOfOrigin: doc.countryOfOrigin,
        language: doc.language,
        freight,
      });
      this.logger.log(`Document ${documentId}: calculation done in ${Date.now() - t2}ms`);

      await this.attachRegulatoryReports(summary.items);

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
        } catch (err) {
          this.logger.warn(`Display rate for ${cur} unavailable: ${errMsg(err)}`);
        }
      }
      doc.exchangeRates = ratesMap;

      const conversion = needsConversion ? { exchangeRate, toRub } : null;
      doc.resultData = summary.items.map((item, i) => {
        item.notes.push(this.buildBreakdownNote(item, currency, needsConversion ? exchangeRate : null));
        return buildResultRow({
          item,
          // Сохраняем, чтобы recalculate мог пересчитать с другой страной без Claude.
          dutyInterpretation: interpreted[i]?.dutyInterpretation ?? null,
          candidateCodes: classified[i]?.candidateCodes ?? null,
          missingDataCategories: classified[i]?.missingDataCategories ?? null,
          conversion,
        });
      });
      let hasRowErrors = false;
      const lowConfidenceReasonsData: RejectionReasonData[] = [];
      for (let i = 0; i < summary.items.length; i++) {
        const item = summary.items[i];
        if (item.calculationStatus === 'error') hasRowErrors = true;
        if (!item.matched || item.matchConfidence < confidenceThreshold) {
          const original = (doc.parsedData?.[i] as { descriptionOriginal?: string } | undefined)
            ?.descriptionOriginal;
          lowConfidenceReasonsData.push(
            this.buildLowConfidenceReason(i, item, confidenceThreshold, original),
          );
        }
      }
      const lowConfidenceReasons = lowConfidenceReasonsData.map((d) => formatRejectionReason(d, 'ru'));
      const lowConfidenceReasonsLocalized = localizeRejectionReasonsForUser(
        lowConfidenceReasonsData,
        doc.language ?? doc.telegramUser?.language,
      );

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
          await this.notify({
            doc,
            status: 'rejected',
            rejectionReasons: lowConfidenceReasons,
            rejectionReasonsLocalized: lowConfidenceReasonsLocalized,
          });
        } else {
          doc.status = DocumentStatus.CODE_REVIEW_REQUIRED;
          await this.repo.save(doc);
          const problemRows = extractProblemRows(
            (doc.resultData ?? []) as Record<string, unknown>[],
            confidenceThreshold,
          );
          await this.notify({ doc, status: 'code_review_required', problemRows });
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
            totalFreight: summary.totalFreight,
            freightCost: doc.freightCost,
            freightCurrency: doc.freightCurrency,
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
      const errorCode = classifyPipelineError(err, ErrorCode.PROCESSING_FAILED);
      await this.notify({ doc, status: 'failed', errorCode });
      this.logger.error(
        `Document ${documentId} processing failed [${errorCode}]: ${doc.errorMessage}`,
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
        this.currencyService.buildCurrencyToDocRates(currency, KNOWN_CURRENCIES),
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

      const freight = this.buildFreightOption(doc, inputs, currencyToDoc);
      const summary = this.calculator.calculate(inputs, commission, {
        currencyToDoc,
        confidenceThreshold,
        countryOfOrigin: doc.countryOfOrigin,
        language: doc.language,
        freight,
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
          freightShare: item.freightShare,
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
          freightShareRub: toRub(item.freightShare),
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
            totalFreight: summary.totalFreight,
            freightCost: doc.freightCost,
            freightCurrency: doc.freightCurrency,
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
   * Заполняет CalculatedProduct.regulatoryReport для каждой позиции с известным
   * `tnvedRaw`. RegulatoryReport дешёвый (regex+поиск стран по in-memory map), но
   * в нём асинхронный резолв OKSMT — поэтому Promise.all. Позиции без tnvedRaw
   * (нет матча TKS) получают null — UI покажет пустую секцию.
   */
  private async attachRegulatoryReports(items: CalculatedProduct[]): Promise<void> {
    await Promise.all(
      items.map(async (item) => {
        if (!item.tnvedRaw) {
          item.regulatoryReport = null;
          return;
        }
        try {
          item.regulatoryReport = await this.regulatoryService.buildReport(item.tnvedRaw);
        } catch (err) {
          this.logger.warn(
            `Regulatory report failed for ${item.tnVedCode}: ${errMsg(err)}`,
          );
          item.regulatoryReport = null;
        }
      }),
    );
  }

  /**
   * Готовит {totalInDocCurrency, weightDenominator} для Calculator из Document.freightCost
   * и текущего набора строк. Возвращает undefined, если у документа фрахта нет или
   * нет курса валюты фрахта к валюте документа — calculator подставит 0 на все позиции.
   * Внутренние warning'и (нулевой знаменатель и т. п.) логирует сам Calculator.
   */
  private buildFreightOption(
    doc: Document,
    products: ReadonlyArray<{ weight: number; quantity: number }>,
    currencyToDoc: Record<string, number>,
  ): { totalInDocCurrency: number; weightDenominator: number } | undefined {
    const total = resolveFreightTotalInDocCurrency(doc, currencyToDoc);
    if (total == null) {
      if (doc.freightCost && doc.freightCurrency) {
        this.logger.warn(
          `Document ${doc.id}: freight ${doc.freightCost} ${doc.freightCurrency} ignored — no rate to document currency ${doc.currency ?? '?'}`,
        );
      }
      return undefined;
    }
    const weightDenominator = computeWeightDenominator(products);
    return { totalInDocCurrency: total, weightDenominator };
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
    errorCode?: string;
    sendResultFile?: boolean;
    rejectionReasons?: string[];
    rejectionReasonsLocalized?: string[];
    problemRows?: ProblemRowSummary[];
  }): Promise<void> {
    const payload = buildDocumentNotificationPayload(opts.doc, opts.status, {
      errorMessage: opts.errorMessage,
      errorCode: opts.errorCode,
      rejectionReasons: opts.rejectionReasons,
      rejectionReasonsLocalized: opts.rejectionReasonsLocalized,
      sendResultFile: opts.sendResultFile,
      problemRows: opts.problemRows,
    });
    if (!payload) return;

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${opts.doc.id}`, err);
    });
  }

  private buildLowConfidenceReason(
    idx: number,
    item: { description: string; tnVedCode?: string; matchConfidence: number; matched: boolean },
    threshold: number,
    descriptionOriginal?: string,
  ): RejectionReasonData {
    const row = idx + 1;
    const description = item.description || '';
    if (!item.matched) {
      return { type: 'low_confidence_no_match', row, description, descriptionOriginal, threshold };
    }
    return {
      type: 'low_confidence_with_code',
      row,
      description,
      descriptionOriginal,
      code: item.tnVedCode || '',
      confidence: item.matchConfidence,
      threshold,
    };
  }
}
