import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TksApiClient, type TnvedCode } from '@direct-port/tks-api';
import { ClientBalanceService } from '../balance/client-balance.service';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { CalculatorService } from '../calculator/calculator.service';
import {
  ClassifierService,
  type ClassifiedProduct,
  type ProductRow,
} from '../classifier/classifier.service';
import { buildRateFields } from '../classifier/classification-assembler';
import { rowNeedsCodeReview } from '../common/confidence';
import { ErrorCode } from '../common/error-codes';
import { errMsg } from '../common/errors';
import { computeWeightDenominator, resolveFreightTotalInDocCurrency } from '../common/freight';
import { KNOWN_CURRENCIES } from '../common/normalize-impedi';
import { toPositiveNumber } from '../common/numbers';
import { normalizeOksmtCode } from '../common/oksmt';
import { normalizeProductAttributes } from '../common/product-attributes';
import { isIncompleteCalculationStatus, type ProductNote } from '../common/product-notes';
import {
  type RejectionReasonData,
  buildLowConfidenceReasonData,
  formatRejectionReason,
} from '../common/rejection-reasons';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import { PipelineNotifierService } from './pipeline-notifier.service';
import { buildResultRow } from './result-row.helper';

interface ResultTotals {
  grandTotal: number;
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  totalLogistics: number;
  totalFreight: number;
}

// Формат rawContext — `ключ=значение; ключ=значение`, его задаёт SYSTEM_PROMPT классификатора.
function mergeUserNoteIntoContext(rawContext: string | undefined, userNote: string): string {
  const base = (rawContext ?? '').trim();
  const noteFragment = `userClarification=${userNote}`;
  return base ? `${base}; ${noteFragment}` : noteFragment;
}

/** Статусы, из которых оператор может начать правку строки (setRowCode/clarifyRow). */
const ROW_EDIT_ENTRY_STATUSES: DocumentStatus[] = [
  DocumentStatus.CODE_REVIEW_REQUIRED,
  DocumentStatus.PROCESSED_WITH_ERRORS,
];

/**
 * Внутри транзакции merge дополнительно допустим PROCESSED: конкурентная правка
 * последней проблемной строки могла довести документ до него — следующая правка
 * всё ещё валидна. Остальные статусы (reprocess увёл в PENDING и т.п.) отвергаются:
 * их resultData вот-вот будет перезаписан.
 */
const ROW_EDIT_TXN_STATUSES: DocumentStatus[] = [
  ...ROW_EDIT_ENTRY_STATUSES,
  DocumentStatus.PROCESSED,
];

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
    private tksApi: TksApiClient,
    private classifier: ClassifierService,
    private dutyInterpreter: DutyInterpreterService,
    private calculator: CalculatorService,
    private currencyService: CurrencyService,
    private configService: CalculationConfigService,
    private calculationLogs: CalculationLogsService,
    private regulatoryService: RegulatoryRequirementsService,
    private pipelineNotifier: PipelineNotifierService,
    private clientBalance: ClientBalanceService,
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

    if (!ROW_EDIT_ENTRY_STATUSES.includes(doc.status)) {
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

    const freight = this.buildFreightOption(doc, rows, currencyToDoc);

    const summary = this.calculator.calculate([interpreted], commission, {
      currencyToDoc,
      confidenceThreshold: config.confidenceThreshold,
      countryOfOrigin: doc.countryOfOrigin,
      language,
      freight,
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
      // Ручная установка кода = код выбран, уточнения не нужны.
      missingDataCategories: null,
      conversion: needsConversion ? { exchangeRate, toRub } : null,
    });

    const { saved, updatedRows } = await this.applyRowUpdate({
      documentId,
      rowIndex,
      newRow,
      confidenceThreshold: config.confidenceThreshold,
      telegramUser: doc.telegramUser,
      addTokenUsage: [{ stage: 'interpreter', usage: interpretResult.tokenUsage }],
    });

    // Доводка кода могла довести документ до PROCESSED — списываем депозит за успешные
    // позиции (идемпотентно: settle сверяет с уже списанным и не задваивает).
    await this.clientBalance.settle(saved);
    await this.pipelineNotifier.notify(saved);

    this.calculationLogs
      .create({
        documentId: saved.id,
        telegramUserId: saved.telegramUser?.telegramId ?? null,
        telegramUsername: saved.telegramUser?.username ?? null,
        fileName: saved.originalFileName,
        itemsCount: updatedRows.length,
        trigger: 'recalculate',
        resultSummary: {
          ...this.sumResultTotals(updatedRows),
          freightCost: saved.freightCost,
          freightCurrency: saved.freightCurrency,
          currency,
        },
      })
      .catch((err) => this.logger.warn(`Failed to write calculation log for ${saved.id}`, err));

    this.logger.log(
      `Document ${saved.id} row ${rowIndex} code set to ${tnVedCode} (status=${saved.status})`,
    );
    return saved;
  }

  // Re-run classifier+interpreter+calculator только для одной строки, обогащая rawContext
  // свободным текстом клиента. Один вызов Claude вместо полного документа — это разница
  // ~$0.05 vs ~$2, поэтому метод вызывается итеративно после каждого уточнения.
  async clarifyRow(
    documentId: string,
    rowIndex: number,
    userNote: string,
  ): Promise<Document> {
    const trimmedNote = userNote.trim();
    if (trimmedNote.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.USER_NOTE_TOO_SHORT,
        message: 'userNote must contain non-whitespace characters',
      });
    }

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

    if (!ROW_EDIT_ENTRY_STATUSES.includes(doc.status)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_CLARIFY,
        message:
          'Row clarification is only available for code_review_required or processed_with_errors documents',
      });
    }

    const rows = (doc.resultData ?? []) as Record<string, unknown>[];
    const parsedRows = (doc.parsedData ?? []) as Record<string, unknown>[];
    if (rowIndex < 0 || rowIndex >= rows.length || rowIndex >= parsedRows.length) {
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_ROW,
        message: `Row index ${rowIndex} out of range (rows: ${rows.length})`,
      });
    }

    const oldRow = rows[rowIndex];
    const parsedRow = parsedRows[rowIndex] ?? {};
    const language = doc.language ?? doc.telegramUser?.language;
    const currency = (doc.currency || 'USD').toUpperCase();
    const [config, currencyToDoc] = await Promise.all([
      this.configService.get(),
      this.currencyService.buildCurrencyToDocRates(currency, KNOWN_CURRENCIES),
    ]);

    // Уточнение хранится в parsedData (применяется в applyRowUpdate), чтобы reprocess
    // подхватил его и админка видела источник правки.
    const updatedParsedRow = { ...parsedRow, userClarification: trimmedNote };

    const rowWeightGross = toPositiveNumber(oldRow.weightGross ?? parsedRow.weightGross);
    const rowAttributes = normalizeProductAttributes(oldRow.attributes ?? parsedRow.attributes);
    const rowCountry = normalizeOksmtCode(
      (oldRow.countryOfOrigin ?? parsedRow.countryOfOrigin) as string | null,
    );
    const productRow: ProductRow = {
      description: String(parsedRow.description ?? oldRow.description ?? ''),
      quantity: Number(oldRow.quantity ?? parsedRow.quantity ?? 1) || 1,
      price: Number(oldRow.price ?? parsedRow.price ?? 0) || 0,
      weight: Number(oldRow.weight ?? parsedRow.weight ?? 0) || 0,
      ...(rowWeightGross ? { weightGross: rowWeightGross } : {}),
      dimensions:
        ((oldRow.dimensions ?? parsedRow.dimensions) as Dimension[] | null | undefined) ?? undefined,
      hsCode: typeof parsedRow.hsCode === 'string' ? parsedRow.hsCode : undefined,
      rawContext: mergeUserNoteIntoContext(
        typeof parsedRow.rawContext === 'string' ? parsedRow.rawContext : undefined,
        trimmedNote,
      ),
      ...(rowCountry ? { countryOfOrigin: rowCountry } : {}),
      ...(rowAttributes ? { attributes: rowAttributes } : {}),
    };

    // auditContext=null отключает vision-retry: у нас уже есть свободный текст, фото добавит токенов без выгоды.
    const classifyResult = await this.classifier.classify(
      [productRow],
      language ?? undefined,
      config.confidenceThreshold,
      null,
    );
    const classified = classifyResult.products[0];

    const commission = {
      pricePercent: config.pricePercent,
      weightRate: config.weightRate,
      fixedFee: config.fixedFee,
    };

    const needsConversion = currency !== 'RUB';
    // interpret / regulatoryReport / getRate независимы после classify — параллелим, чтобы
    // время уточнения было ~300мс вместо ~800мс с последовательными awaits.
    const [interpretResult, regulatoryReport, exchangeRate] = await Promise.all([
      this.dutyInterpreter.interpret([classified], language ?? undefined),
      classified.tnvedRaw
        ? this.regulatoryService.buildReport(classified.tnvedRaw).catch((err) => {
            this.logger.warn(
              `Regulatory report failed for ${classified.tnVedCode}: ${errMsg(err)}`,
            );
            return null;
          })
        : Promise.resolve(null),
      needsConversion ? this.currencyService.getRate(currency) : Promise.resolve(1),
    ]);
    const interpreted = interpretResult.products[0];

    const freight = this.buildFreightOption(doc, rows, currencyToDoc);

    const summary = this.calculator.calculate([interpreted], commission, {
      currencyToDoc,
      confidenceThreshold: config.confidenceThreshold,
      countryOfOrigin: doc.countryOfOrigin,
      language: language ?? undefined,
      freight,
    });
    const calculated = summary.items[0];
    calculated.regulatoryReport = regulatoryReport;

    const toRub = (v: number) => this.currencyService.toRubSync(v, exchangeRate);

    const newRow = buildResultRow({
      item: calculated,
      dutyInterpretation: interpreted.dutyInterpretation ?? null,
      candidateCodes: classified.candidateCodes ?? null,
      missingDataCategories: classified.missingDataCategories ?? null,
      conversion: needsConversion ? { exchangeRate, toRub } : null,
    });

    const { saved, updatedRows } = await this.applyRowUpdate({
      documentId,
      rowIndex,
      newRow,
      confidenceThreshold: config.confidenceThreshold,
      telegramUser: doc.telegramUser,
      updatedParsedRow,
      addTokenUsage: [
        { stage: 'classifier', usage: classifyResult.tokenUsage },
        { stage: 'interpreter', usage: interpretResult.tokenUsage },
      ],
    });

    // Уточнение могло довести документ до PROCESSED — списываем депозит за успешные
    // позиции (идемпотентно: settle сверяет с уже списанным и не задваивает).
    await this.clientBalance.settle(saved);
    await this.pipelineNotifier.notify(saved);

    this.calculationLogs
      .create({
        documentId: saved.id,
        telegramUserId: saved.telegramUser?.telegramId ?? null,
        telegramUsername: saved.telegramUser?.username ?? null,
        fileName: saved.originalFileName,
        itemsCount: updatedRows.length,
        trigger: 'recalculate',
        resultSummary: {
          ...this.sumResultTotals(updatedRows),
          freightCost: saved.freightCost,
          freightCurrency: saved.freightCurrency,
          currency,
        },
      })
      .catch((err) => this.logger.warn(`Failed to write calculation log for ${saved.id}`, err));

    this.logger.log(
      `Document ${saved.id} row ${rowIndex} clarified (note=${trimmedNote.length}ch, code=${classified.tnVedCode}, confidence=${classified.matchConfidence.toFixed(2)}, status=${saved.status})`,
    );
    return saved;
  }

  /**
   * Короткая транзакция «перечитать под локом → заменить одну строку → пересчитать
   * статус → сохранить». Между findOne в начале setRowCode/clarifyRow и записью
   * проходят секунды (TKS, interpret, calculate, Claude) — за это время параллельная
   * правка ДРУГОЙ строки (итеративные карточки в боте, два оператора) затиралась бы
   * последним save целого массива resultData. Слияние по свежим строкам это исключает.
   */
  private async applyRowUpdate(opts: {
    documentId: string;
    rowIndex: number;
    newRow: Record<string, unknown>;
    confidenceThreshold: number;
    telegramUser: Document['telegramUser'];
    updatedParsedRow?: Record<string, unknown>;
    addTokenUsage?: Array<{ stage: string; usage: Parameters<typeof addStageUsage>[2] }>;
  }): Promise<{ saved: Document; updatedRows: Record<string, unknown>[] }> {
    const result = await this.repo.manager.transaction(async (em) => {
      const repo = em.getRepository(Document);
      // pessimistic_write несовместим с relations (outer join) — telegramUser
      // берём из исходной загрузки вызывающего метода.
      const fresh = await repo.findOne({
        where: { id: opts.documentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fresh) {
        throw new NotFoundException({
          code: ErrorCode.DOCUMENT_NOT_FOUND,
          message: 'Document not found',
        });
      }
      if (!ROW_EDIT_TXN_STATUSES.includes(fresh.status)) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_STATUS_FOR_SET_CODE,
          message: 'Document status changed concurrently — refresh and try again',
        });
      }
      const rows = (fresh.resultData ?? []) as Record<string, unknown>[];
      if (opts.rowIndex < 0 || opts.rowIndex >= rows.length) {
        throw new BadRequestException({
          code: ErrorCode.UNKNOWN_ROW,
          message: `Row index ${opts.rowIndex} out of range (rows: ${rows.length})`,
        });
      }

      const updatedRows = rows.map((r, i) => (i === opts.rowIndex ? opts.newRow : r));
      fresh.resultData = updatedRows;
      if (opts.updatedParsedRow) {
        const parsed = (fresh.parsedData ?? []) as Record<string, unknown>[];
        fresh.parsedData = parsed.map((r, i) =>
          i === opts.rowIndex ? opts.updatedParsedRow! : r,
        );
      }
      for (const { stage, usage } of opts.addTokenUsage ?? []) {
        fresh.tokenUsage = addStageUsage(fresh.tokenUsage ?? {}, stage, usage);
      }

      const { rejectionReasons, hasRowErrors } = this.recomputeReasons(
        updatedRows,
        opts.confidenceThreshold,
        (fresh.parsedData ?? []) as Record<string, unknown>[],
      );
      if (rejectionReasons.length > 0) {
        fresh.rejectionReasons = rejectionReasons;
        fresh.status = DocumentStatus.CODE_REVIEW_REQUIRED;
      } else {
        fresh.rejectionReasons = null;
        fresh.status = hasRowErrors
          ? DocumentStatus.PROCESSED_WITH_ERRORS
          : DocumentStatus.PROCESSED;
      }
      // Точечный update вместо save: save перечитывает всю строку (включая большие
      // JSONB) ради diff'а — лишний round-trip под удерживаемым row-локом.
      await repo.update(opts.documentId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM QueryDeepPartialEntity rejects Record[] for jsonb column
        resultData: fresh.resultData as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- то же для parsedData
        parsedData: fresh.parsedData as any,
        tokenUsage: fresh.tokenUsage,
        rejectionReasons: fresh.rejectionReasons,
        status: fresh.status,
      });
      return { saved: fresh, updatedRows };
    });
    result.saved.telegramUser = opts.telegramUser;
    return result;
  }

  /**
   * Готовит freight-опцию для Calculator: общая сумма в валюте документа и знаменатель
   * по ВСЕМ строкам документа (а не только по пересчитываемой), чтобы share единственной
   * строки совпала с долей, которую полный pipeline дал бы той же строке.
   */
  private buildFreightOption(
    doc: Document,
    rows: ReadonlyArray<{ weight?: number | null; quantity?: number | null }>,
    currencyToDoc: Record<string, number>,
  ): { totalInDocCurrency: number; weightDenominator: number } | undefined {
    const total = resolveFreightTotalInDocCurrency(doc, currencyToDoc);
    if (total == null) {
      if (doc.freightCost && doc.freightCurrency) {
        this.logger.warn(
          `Document ${doc.id}: freight ${doc.freightCost} ${doc.freightCurrency} ignored — no rate to document currency`,
        );
      }
      return undefined;
    }
    return { totalInDocCurrency: total, weightDenominator: computeWeightDenominator(rows) };
  }

  private sumResultTotals(rows: Record<string, unknown>[]): ResultTotals {
    return rows.reduce<ResultTotals>(
      (acc, r) => ({
        grandTotal: acc.grandTotal + (Number(r.totalCost) || 0),
        totalDuty: acc.totalDuty + (Number(r.dutyAmount) || 0),
        totalVat: acc.totalVat + (Number(r.vatAmount) || 0),
        totalExcise: acc.totalExcise + (Number(r.exciseAmount) || 0),
        totalLogistics: acc.totalLogistics + (Number(r.logisticsCommission) || 0),
        totalFreight: acc.totalFreight + (Number(r.freightShare) || 0),
      }),
      { grandTotal: 0, totalDuty: 0, totalVat: 0, totalExcise: 0, totalLogistics: 0, totalFreight: 0 },
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
    const description = String(oldRow.description ?? '');
    const weightGross = toPositiveNumber(oldRow.weightGross);
    const rowCountry = normalizeOksmtCode(oldRow.countryOfOrigin as string | null);
    return {
      description,
      quantity: Number(oldRow.quantity) || 1,
      price: Number(oldRow.price) || 0,
      weight: Number(oldRow.weight) || 0,
      ...(weightGross ? { weightGross } : {}),
      ...(rowCountry ? { countryOfOrigin: rowCountry } : {}),
      dimensions: (oldRow.dimensions as Dimension[] | null) ?? undefined,
      // Единый источник rate-полей (включая supplementaryUnit) с pipeline-сборкой.
      ...buildRateFields(tnved),
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
    parsedRows: Record<string, unknown>[] = [],
  ): {
    rejectionReasons: string[];
    hasRowErrors: boolean;
  } {
    const data: RejectionReasonData[] = [];
    let hasRowErrors = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isIncompleteCalculationStatus(row.calculationStatus)) hasRowErrors = true;
      if (rowNeedsCodeReview(row, threshold)) {
        const description = String(row.description ?? '');
        const rawOriginal = String(parsedRows[i]?.descriptionOriginal ?? '').trim();
        const descriptionOriginal = rawOriginal && rawOriginal !== description ? rawOriginal : undefined;
        data.push(buildLowConfidenceReasonData(i + 1, row, threshold, descriptionOriginal));
      }
    }
    return {
      rejectionReasons: data.map((d) => formatRejectionReason(d, 'ru')),
      hasRowErrors,
    };
  }
}
