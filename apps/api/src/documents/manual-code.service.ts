import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { TksApiClient, type TnvedCode } from '@direct-port/tks-api';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService } from '../calculator/calculator.service';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import { ErrorCode } from '../common/error-codes';
import { errMsg } from '../common/errors';
import { KNOWN_CURRENCIES, normalizeImpediUnit } from '../common/normalize-impedi';
import type { ProductNote } from '../common/product-notes';
import {
  type RejectionReasonData,
  formatRejectionReason,
  localizeRejectionReasonsForUser,
} from '../common/rejection-reasons';
import { CurrencyService } from '../currency/currency.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import { buildDocumentNotificationPayload, type DocumentNotification } from './notification';
import { buildResultRow } from './result-row.helper';

interface ResultTotals {
  grandTotal: number;
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  totalLogistics: number;
}

/**
 * Ручная установка кода ТН ВЭД оператором для конкретной строки документа.
 *
 * Сценарий: документ ушёл в CODE_REVIEW_REQUIRED, потому что классификатор не уверен
 * хотя бы в одной строке. Оператор открывает документ, видит топ-3 кандидатов от Claude
 * (`row.candidateCodes`) или вводит свой код, нажимает «Применить» — этот сервис:
 *  1) валидирует код через TKS (если кода нет в справочнике — 400),
 *  2) переинтерпретирует пошлины (DutyInterpreter, кэш делает это бесплатным для известных кодов),
 *  3) пересчитывает только эту строку,
 *  4) обновляет resultData/rejectionReasons и переводит статус в PROCESSED, если больше
 *     нет проблемных строк.
 *
 * НЕ пересчитывает остальные строки — они остаются как есть. CalculationLog пишется
 * с триггером 'recalculate'.
 */
@Injectable()
export class ManualCodeService {
  private logger = new Logger(ManualCodeService.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-notifications') private notificationQueue: Queue,
    private tksApi: TksApiClient,
    private dutyInterpreter: DutyInterpreterService,
    private calculator: CalculatorService,
    private currencyService: CurrencyService,
    private configService: CalculationConfigService,
    private calculationLogs: CalculationLogsService,
    private regulatoryService: RegulatoryRequirementsService,
  ) {}

  async setRowCode(
    documentId: string,
    rowIndex: number,
    tnVedCode: string,
  ): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id: documentId },
      relations: ['telegramUser'],
    });
    if (!doc) {
      throw new NotFoundException({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }

    if (
      doc.status !== DocumentStatus.CODE_REVIEW_REQUIRED &&
      doc.status !== DocumentStatus.PROCESSED_WITH_ERRORS
    ) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_SET_CODE,
        message:
          'Manual code edit is only available for code_review_required or processed_with_errors documents',
      });
    }

    const rows = (doc.resultData ?? []) as Record<string, unknown>[];
    if (rowIndex < 0 || rowIndex >= rows.length) {
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_ROW,
        message: `Row index ${rowIndex} out of range (rows: ${rows.length})`,
      });
    }

    const tnved = await this.fetchTnvedOrThrow(tnVedCode);

    const oldRow = rows[rowIndex];
    const language = doc.language ?? doc.telegramUser?.language;
    const currency = (doc.currency || 'USD').toUpperCase();
    const [config, currencyToDoc] = await Promise.all([
      this.configService.get(),
      this.currencyService.buildCurrencyToDocRates(currency, KNOWN_CURRENCIES),
    ]);
    const commission = {
      pricePercent: config.pricePercent,
      weightRate: config.weightRate,
      fixedFee: config.fixedFee,
    };

    const classified = this.buildClassifiedFromTnved(oldRow, tnved);

    // DutyInterpreter переиспользует L1+L2 кэш по коду — для уже знакомых кодов
    // это вообще не дёргает Claude. Для новых — один батч из одного товара.
    const interpretResult = await this.dutyInterpreter.interpret([classified], language);
    const interpreted = interpretResult.products[0];

    const summary = this.calculator.calculate([interpreted], commission, {
      currencyToDoc,
      confidenceThreshold: config.confidenceThreshold,
      countryOfOrigin: doc.countryOfOrigin,
    });
    const calculated = summary.items[0];

    try {
      calculated.regulatoryReport = await this.regulatoryService.buildReport(tnved);
    } catch (err) {
      this.logger.warn(`Regulatory report failed for ${tnved.CODE}: ${errMsg(err)}`);
      calculated.regulatoryReport = null;
    }

    const needsConversion = currency !== 'RUB';
    const exchangeRate = needsConversion ? await this.currencyService.getRate(currency) : 1;
    const toRub = (v: number) => this.currencyService.toRubSync(v, exchangeRate);

    const newRow = buildResultRow({
      item: calculated,
      dutyInterpretation: interpreted.dutyInterpretation ?? null,
      candidateCodes: null,
      conversion: needsConversion ? { exchangeRate, toRub } : null,
    });

    const updatedRows = rows.map((r, i) => (i === rowIndex ? newRow : r));
    doc.resultData = updatedRows;

    const { rejectionReasons, hasRowErrors } = this.recomputeReasons(
      updatedRows,
      config.confidenceThreshold,
      doc.language ?? doc.telegramUser?.language,
    );

    if (rejectionReasons.length > 0) {
      doc.rejectionReasons = rejectionReasons;
      doc.status = DocumentStatus.CODE_REVIEW_REQUIRED;
    } else {
      doc.rejectionReasons = null;
      doc.status = hasRowErrors
        ? DocumentStatus.PROCESSED_WITH_ERRORS
        : DocumentStatus.PROCESSED;
    }

    const saved = await this.repo.save(doc);

    if (saved.status === DocumentStatus.PROCESSED) {
      await this.enqueueNotification(saved, 'processed');
    } else if (saved.status === DocumentStatus.PROCESSED_WITH_ERRORS) {
      await this.enqueueNotification(saved, 'processed_with_errors');
    }

    this.calculationLogs
      .create({
        documentId: saved.id,
        telegramUserId: saved.telegramUser?.telegramId ?? null,
        telegramUsername: saved.telegramUser?.username ?? null,
        fileName: saved.originalFileName,
        itemsCount: updatedRows.length,
        trigger: 'recalculate',
        resultSummary: { ...this.sumResultTotals(updatedRows), currency },
      })
      .catch((err) => this.logger.warn(`Failed to write calculation log for ${saved.id}`, err));

    this.logger.log(
      `Document ${saved.id} row ${rowIndex} code set to ${tnVedCode} (status=${saved.status})`,
    );
    return saved;
  }

  private sumResultTotals(rows: Record<string, unknown>[]): ResultTotals {
    return rows.reduce<ResultTotals>(
      (acc, r) => ({
        grandTotal: acc.grandTotal + (Number(r.totalCost) || 0),
        totalDuty: acc.totalDuty + (Number(r.dutyAmount) || 0),
        totalVat: acc.totalVat + (Number(r.vatAmount) || 0),
        totalExcise: acc.totalExcise + (Number(r.exciseAmount) || 0),
        totalLogistics: acc.totalLogistics + (Number(r.logisticsCommission) || 0),
      }),
      { grandTotal: 0, totalDuty: 0, totalVat: 0, totalExcise: 0, totalLogistics: 0 },
    );
  }

  private async fetchTnvedOrThrow(tnVedCode: string): Promise<TnvedCode> {
    try {
      const tnved = await this.tksApi.getTnvedCode(tnVedCode);
      if (!tnved || !tnved.CODE) throw new Error('TKS returned empty TNVED');
      return tnved;
    } catch (err) {
      this.logger.warn(`TNVED lookup failed for ${tnVedCode}: ${errMsg(err)}`);
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_TNVED_CODE,
        message: `TNVED code ${tnVedCode} not found in TKS reference`,
      });
    }
  }

  private buildClassifiedFromTnved(
    oldRow: Record<string, unknown>,
    tnved: TnvedCode,
  ): ClassifiedProduct {
    const rates = tnved.TNVED ?? {};
    const description = String(oldRow.description ?? '');
    return {
      description,
      quantity: Number(oldRow.quantity) || 1,
      price: Number(oldRow.price) || 0,
      weight: Number(oldRow.weight) || 0,
      dimensions: (oldRow.dimensions as Dimension[] | null) ?? undefined,
      tnVedCode: tnved.CODE,
      tnVedDescription: tnved.KR_NAIM,
      dutyRate: rates.IMP ?? 0,
      dutyRateUnit: normalizeImpediUnit(rates.IMPEDI),
      dutySign: rates.IMPSIGN ?? null,
      dutyMin: rates.IMP2 ?? null,
      dutyMinUnit: normalizeImpediUnit(rates.IMPEDI2),
      vatRate: rates.NDS ?? 20,
      exciseRate: rates.AKC ?? 0,
      // Ручной выбор оператора = полная уверенность для целей расчёта/статуса.
      matchConfidence: 1,
      matched: true,
      tnvedRaw: tnved,
      verified: true,
      suggestedCode: null,
      verificationComment: 'Код выбран оператором вручную',
      notes: [
        {
          stage: 'classify',
          severity: 'info',
          field: 'code',
          message: `Код ${tnved.CODE} выбран оператором вручную.`,
        } satisfies ProductNote,
      ],
    };
  }

  private recomputeReasons(
    rows: Record<string, unknown>[],
    threshold: number,
    language: string | null | undefined,
  ): {
    rejectionReasons: string[];
    rejectionReasonsLocalized: string[] | undefined;
    hasRowErrors: boolean;
  } {
    const data: RejectionReasonData[] = [];
    let hasRowErrors = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const matched = Boolean(row.matched);
      const confidence = Number(row.matchConfidence) || 0;
      const calcStatus = String(row.calculationStatus ?? '');
      if (calcStatus === 'error') hasRowErrors = true;
      if (!matched || confidence < threshold) {
        const description = String(row.description ?? '');
        if (!matched) {
          data.push({ type: 'low_confidence_no_match', row: i + 1, description, threshold });
        } else {
          data.push({
            type: 'low_confidence_with_code',
            row: i + 1,
            description,
            code: String(row.tnVedCode ?? ''),
            confidence,
            threshold,
          });
        }
      }
    }
    return {
      rejectionReasons: data.map((d) => formatRejectionReason(d, 'ru')),
      rejectionReasonsLocalized: localizeRejectionReasonsForUser(data, language ?? undefined),
      hasRowErrors,
    };
  }

  private async enqueueNotification(
    doc: Document,
    status: DocumentNotification['status'],
  ): Promise<void> {
    const payload = buildDocumentNotificationPayload(doc, status, {});
    if (!payload) return;
    await this.notificationQueue
      .add('document-ready', payload)
      .catch((err) =>
        this.logger.warn(`Failed to enqueue notification for ${doc.id}`, err),
      );
  }
}
