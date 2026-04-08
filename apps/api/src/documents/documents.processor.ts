import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { ClassifierService } from '../classifier/classifier.service';
import { CalculatorService } from '../calculator/calculator.service';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { VerificationService } from '../verification/verification.service';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import { CurrencyService } from '../currency/currency.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';

export interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'failed';
  errorMessage?: string;
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
    private verification: VerificationService,
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
      const rows = (doc.parsedData ?? []).map((row) => ({
        description: String(row.description ?? ''),
        quantity: Number(row.quantity) || 1,
        price: Number(row.price) || 0,
        weight: Number(row.weight) || 0,
      }));

      const { pricePercent, weightRate, fixedFee } = await this.configService.get();
      const commission = { pricePercent, weightRate, fixedFee };

      const classified = await this.classifier.classify(rows);
      const verified = await this.verification.verify(classified);
      const interpreted = await this.dutyInterpreter.interpret(verified);

      // EUR→doc rate for specific duty amounts (EUR/kg, EUR/m2, etc.)
      const currency = doc.currency || 'USD';
      let eurToDoc = 1;
      if (currency !== 'EUR') {
        const eurRate = await this.currencyService.getRate('EUR');
        const docRate = currency === 'RUB' ? 1 : await this.currencyService.getRate(currency);
        eurToDoc = eurRate / docRate;
      }

      const summary = this.calculator.calculateInterpreted(interpreted, commission, { eurToDoc });

      const needsConversion = currency !== 'RUB';
      let exchangeRate = 1;
      if (needsConversion) {
        exchangeRate = await this.currencyService.getRate(currency);
      }
      const toRub = (v: number) => this.currencyService.toRubSync(v, exchangeRate);

      doc.resultData = summary.items.map((item, i) => {
        const base = {
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          weight: item.weight,
          tnVedCode: item.tnVedCode,
          tnVedDescription: item.tnVedDescription,
          dutyRate: item.dutyRate,
          vatRate: item.vatRate,
          exciseRate: item.exciseRate,
          totalPrice: item.totalPrice,
          dutyAmount: item.dutyAmount,
          vatAmount: item.vatAmount,
          exciseAmount: item.exciseAmount,
          logisticsCommission: item.logisticsCommission,
          totalCost: item.totalCost,
          verificationStatus: item.verificationStatus,
          matchConfidence: item.matchConfidence,
          verified: verified[i]?.verified ?? false,
          verificationComment: verified[i]?.verificationComment ?? null,
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
      doc.status = DocumentStatus.PROCESSED;
      await this.repo.save(doc);

      await this.notify(doc, 'processed');

      this.calculationLogs.create({
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
      }).catch((err) => {
        this.logger.warn(`Failed to write calculation log for ${documentId}`, err);
      });
      this.logger.log(
        `Document ${documentId} processed: ${rows.length} rows, grandTotal=${summary.grandTotal}`,
      );
    } catch (err) {
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await this.repo.save(doc);
      await this.notify(doc, 'failed', doc.errorMessage ?? undefined);
      this.logger.error(`Document ${documentId} failed`, err);
    }
  }

  private async notify(
    doc: Document,
    status: 'processed' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    const telegramId = doc.telegramUser?.telegramId;
    if (!telegramId) return;

    const payload: DocumentNotification = {
      documentId: doc.id,
      telegramUserId: telegramId,
      status,
      errorMessage,
    };

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${doc.id}`, err);
    });
  }
}
