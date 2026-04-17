import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService, type CalculatedProduct } from '../calculator/calculator.service';
import { ClassifierService, type ProductRow } from '../classifier/classifier.service';
import { errMsg } from '../common/errors';
import type { ProductNote } from '../common/product-notes';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
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
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
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

      const {
        pricePercent,
        weightRate,
        fixedFee,
        sendResultFile,
        confidenceThreshold,
        lowConfidenceAction,
      } = await this.configService.get();
      const commission = { pricePercent, weightRate, fixedFee };

      const language = doc.language ?? doc.telegramUser?.language;

      const t0 = Date.now();
      const classifyResult = await this.classifier.classify(rows, language, confidenceThreshold);
      const classified = classifyResult.products;
      doc.tokenUsage = addStageUsage(doc.tokenUsage ?? {}, 'classifier', classifyResult.tokenUsage);
      this.logger.log(`Document ${documentId}: classification done in ${Date.now() - t0}ms`);

      const t1 = Date.now();
      const interpretResult = await this.dutyInterpreter.interpret(classified, language);
      const interpreted = interpretResult.products;
      doc.tokenUsage = addStageUsage(doc.tokenUsage, 'interpreter', interpretResult.tokenUsage);
      this.logger.log(`Document ${documentId}: interpretation done in ${Date.now() - t1}ms`);

      // EUR→doc rate for specific duty amounts (EUR/kg, EUR/m2, etc.)
      const currency = doc.currency || 'USD';
      let eurToDoc = 1;
      if (currency !== 'EUR') {
        const eurRate = await this.currencyService.getRate('EUR');
        const docRate = currency === 'RUB' ? 1 : await this.currencyService.getRate(currency);
        eurToDoc = eurRate / docRate;
      }
      this.logger.log(`Document ${documentId}: eurToDoc=${eurToDoc.toFixed(4)}, currency=${currency}`);

      const t2 = Date.now();
      const summary = this.calculator.calculate(interpreted, commission, {
        eurToDoc,
        confidenceThreshold,
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
          dutyRateDisplay: item.dutyRateDisplay,
          vatRate: item.vatRate,
          exciseRate: item.exciseRate,
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
