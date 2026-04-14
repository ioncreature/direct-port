import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService } from '../calculator/calculator.service';
import { ClassifierService, type ProductRow } from '../classifier/classifier.service';
import { errMsg } from '../common/errors';
import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';

export interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'processed_with_errors' | 'failed' | 'rejected';
  errorMessage?: string;
  rejectionReasons?: string[];
  language?: string;
  outputFileName?: string;
}

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

      const { pricePercent, weightRate, fixedFee } = await this.configService.get();
      const commission = { pricePercent, weightRate, fixedFee };

      const language = doc.language ?? doc.telegramUser?.language;

      const t0 = Date.now();
      const classifyResult = await this.classifier.classify(rows, language);
      const classified = classifyResult.products;
      this.logger.log(`Document ${documentId}: classification done in ${Date.now() - t0}ms`);

      const t1 = Date.now();
      const interpretResult = await this.dutyInterpreter.interpret(classified, language);
      const interpreted = interpretResult.products;
      this.logger.log(`Document ${documentId}: interpretation done in ${Date.now() - t1}ms`);

      doc.tokenUsage = addStageUsage(doc.tokenUsage ?? {}, 'classifier', classifyResult.tokenUsage);
      doc.tokenUsage = addStageUsage(doc.tokenUsage, 'interpreter', interpretResult.tokenUsage);

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
      const summary = this.calculator.calculate(interpreted, commission, { eurToDoc });
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
        const base = {
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          weight: item.weight,
          dimensions: item.dimensions ?? null,
          tnVedCode: item.tnVedCode,
          tnVedDescription: item.tnVedDescription,
          dutyRate: item.dutyRate,
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
      const hasRowErrors = summary.items.some(
        (item) => item.calculationStatus === 'error',
      );
      doc.status = hasRowErrors
        ? DocumentStatus.PROCESSED_WITH_ERRORS
        : DocumentStatus.PROCESSED;
      await this.repo.save(doc);

      await this.notify(doc, hasRowErrors ? 'processed_with_errors' : 'processed');

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
      await this.notify(doc, 'failed', doc.errorMessage ?? undefined);
      this.logger.error(
        `Document ${documentId} processing failed: ${doc.errorMessage}`,
        err instanceof Error ? err.stack : err,
      );
    }
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

  private async notify(
    doc: Document,
    status: 'processed' | 'processed_with_errors' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    const telegramId = doc.telegramUser?.telegramId;
    if (!telegramId) return;

    const clientName = getDocumentClientName(doc);
    const payload: DocumentNotification = {
      documentId: doc.id,
      telegramUserId: telegramId,
      status,
      errorMessage,
      language: doc.language ?? doc.telegramUser?.language,
      outputFileName: buildOutputFileName(doc.createdAt, clientName),
    };

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${doc.id}`, err);
    });
  }
}
