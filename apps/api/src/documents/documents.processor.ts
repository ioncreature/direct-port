import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { CalculationConfigService } from '../calculation-config/calculation-config.service';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { ClientBalanceService } from '../balance/client-balance.service';
import { CalculatorService, type CalculatedProduct, type CalculatorInput } from '../calculator/calculator.service';
import { ClassifierService, type ProductRow } from '../classifier/classifier.service';
import { rowNeedsCodeReview } from '../common/confidence';
import { ErrorCode } from '../common/error-codes';
import { classifyPipelineError, errMsg } from '../common/errors';
import { computeWeightDenominator, resolveFreightTotalInDocCurrency } from '../common/freight';
import {
  defaultCountryWarningNote,
  freightIgnoredWarningNote,
  isIncompleteCalculationStatus,
  type ProductNote,
} from '../common/product-notes';
import { toPositiveNumber } from '../common/numbers';
import { normalizeProductAttributes } from '../common/product-attributes';
import {
  type RejectionReasonData,
  buildLowConfidenceReasonData,
  formatRejectionReason,
} from '../common/rejection-reasons';
import { addStageUsage } from '../common/token-usage';
import { CurrencyService } from '../currency/currency.service';
import { KNOWN_CURRENCIES } from '../common/normalize-impedi';
import { buildResultRow, buildRubFields } from './result-row.helper';
import { DEFAULT_COUNTRY_OF_ORIGIN, Document, DocumentStatus } from '../database/entities/document.entity';
import { DutyInterpreterService } from '../duty-interpreter/duty-interpreter.service';
import type { Dimension } from '../duty-interpreter/interfaces';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import { PipelineNotifierService } from './pipeline-notifier.service';

@Processor('document-processing')
export class DocumentsProcessor extends WorkerHost {
  private logger = new Logger(DocumentsProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    private classifier: ClassifierService,
    private calculator: CalculatorService,
    private configService: CalculationConfigService,
    private dutyInterpreter: DutyInterpreterService,
    private currencyService: CurrencyService,
    private calculationLogs: CalculationLogsService,
    private audit: PipelineAuditService,
    private regulatoryService: RegulatoryRequirementsService,
    private pipelineNotifier: PipelineNotifierService,
    private clientBalance: ClientBalanceService,
  ) {
    super();
  }

  /**
   * Блокировка обработки при нехватке депозита клиента. Число позиций известно только
   * после парсинга, поэтому гейт стоит здесь, на входе воркера: при нехватке документ
   * уходит в FAILED с понятным сообщением (менеджер пополняет баланс и жмёт «Переобработать»).
   * Документы без привязанного клиента (загрузки из админки) пропускаются. Возвращает
   * true, если обработку нужно прервать.
   */
  private async blockIfInsufficientBalance(doc: Document): Promise<boolean> {
    const gate = await this.clientBalance.checkProcessingAllowed(doc);
    if (gate.allowed) return false;
    doc.status = DocumentStatus.FAILED;
    doc.errorMessage =
      `Недостаточно баланса клиента: нужно ${gate.need}, на балансе ${gate.available}. ` +
      `Пополните депозит клиента в админке и запустите обработку снова.`;
    await this.repo.save(doc);
    await this.pipelineNotifier.notify(doc);
    this.logger.warn(
      `Document ${doc.id} blocked: insufficient balance (need ${gate.need}, have ${gate.available})`,
    );
    return true;
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

    // Guard от повторной доставки job (stalled-повтор после крэша/деплоя, двойной
    // клик reprocess): воркер не идемпотентен (CalculationLog, уведомление, Excel
    // клиенту), поэтому повтор для уже завершённого документа выходим молча.
    // Прерванный посреди прогона документ (PROCESSING) подбирает watchdog → FAILED →
    // оператор перезапускает reprocess'ом.
    if (doc.status !== DocumentStatus.PENDING) {
      this.logger.warn(
        `Document ${documentId} is "${doc.status}", not "pending" — skipping duplicate processing job`,
      );
      return;
    }

    if (await this.blockIfInsufficientBalance(doc)) return;

    doc.status = DocumentStatus.PROCESSING;
    await this.repo.save(doc);

    const attempt = (job.attemptsMade ?? 0) + 1;
    let currentStageRunId: string | null = null;

    try {
      const rows: ProductRow[] = (doc.parsedData ?? []).map((row) => {
        const notes: ProductNote[] = [];
        // Нечисловой мусор в parsedData (после ручной правки оператором) раньше молча
        // превращался в 0/1 — строка уходила в PROCESSED с нулевой пошлиной без следа.
        const num = (field: 'quantity' | 'price' | 'weight', fallback: number): number => {
          const raw = row[field];
          const n = Number(raw);
          if (raw != null && raw !== '' && Number.isNaN(n)) {
            notes.push({
              stage: 'parse',
              severity: 'warning',
              field,
              message: `Значение «${String(raw)}» в поле ${field} не распознано как число — использовано ${fallback}.`,
            });
          }
          return n || fallback;
        };
        const weightGross = toPositiveNumber(row.weightGross);
        const attributes = normalizeProductAttributes(row.attributes);
        return {
          description: String(row.description ?? ''),
          quantity: num('quantity', 1),
          price: num('price', 0),
          weight: num('weight', 0),
          ...(weightGross ? { weightGross } : {}),
          dimensions: this.extractDimensions(row),
          notes,
          ...(typeof row.hsCode === 'string' && row.hsCode ? { hsCode: row.hsCode } : {}),
          ...(typeof row.rawContext === 'string' && row.rawContext ? { rawContext: row.rawContext } : {}),
          ...(attributes ? { attributes } : {}),
        };
      });

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

      // Курс ЦБ на финальной конвертации: к этому моменту classify+interpret уже
      // оплачены (минуты вызовов Claude), поэтому недоступный курс НЕ роняет прогон
      // в общий catch. Сохраняем resultData без RUB-полей и ставим FAILED с понятной
      // ошибкой — recalculate (разрешён для FAILED с сохранённым resultData)
      // доконвертирует позже без повторных вызовов Claude.
      const needsConversion = currency !== 'RUB';
      let exchangeRate = 1;
      let rateError: unknown = null;
      if (needsConversion) {
        try {
          exchangeRate = await this.currencyService.getRate(currency);
        } catch (err) {
          rateError = err;
          this.logger.error(
            `Document ${documentId}: CBR rate for ${currency} unavailable (${errMsg(err)}), saving result without RUB conversion`,
          );
        }
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

      const converted = needsConversion && !rateError;
      const conversion = converted ? { exchangeRate, toRub } : null;
      doc.resultData = summary.items.map((item, i) => {
        item.notes.push(this.buildBreakdownNote(item, currency, converted ? exchangeRate : null));
        return buildResultRow({
          item,
          // Сохраняем, чтобы recalculate мог пересчитать с другой страной без Claude.
          dutyInterpretation: interpreted[i]?.dutyInterpretation ?? null,
          candidateCodes: classified[i]?.candidateCodes ?? null,
          missingDataCategories: classified[i]?.missingDataCategories ?? null,
          conversion,
        });
      });
      const issues = this.collectRowIssues(doc, summary.items, confidenceThreshold);
      const { hasRowErrors, reasons: lowConfidenceReasons } = issues;

      void this.audit.completeStageRun(currentStageRunId, {
        output: {
          grandTotal: summary.grandTotal,
          totalDuty: summary.totalDuty,
          totalVat: summary.totalVat,
          totalExcise: summary.totalExcise,
          totalLogistics: summary.totalLogistics,
          items: summary.items,
          exchangeRates: doc.exchangeRates,
          exchangeRate: converted ? exchangeRate : null,
          hasRowErrors,
          lowConfidenceReasons,
        },
        partial: summary.usedFallback || Boolean(rateError),
      });
      currentStageRunId = null;

      if (rateError) {
        doc.status = DocumentStatus.FAILED;
        doc.errorMessage =
          'Курсы валют ЦБ РФ недоступны — суммы в RUB не рассчитаны. ' +
          'Выполните «Пересчитать», когда курсы снова появятся.';
        await this.repo.save(doc);
        await this.pipelineNotifier.notify(doc);
        return;
      }

      await this.applyFinalStatusAndNotify(doc, issues, { lowConfidenceAction });

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
      await this.pipelineNotifier.notify(doc);
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

    // Guard от повторной доставки job — симметрично process(): service ставит PENDING
    // перед постановкой recalculate-job, повтор для уже завершённого документа
    // (включая stalled-повтор после save финального статуса) выходит молча.
    if (doc.status !== DocumentStatus.PENDING) {
      this.logger.warn(
        `Document ${documentId} is "${doc.status}", not "pending" — skipping duplicate recalculate job`,
      );
      return;
    }

    if (await this.blockIfInsufficientBalance(doc)) return;

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
      const {
        pricePercent,
        weightRate,
        fixedFee,
        confidenceThreshold,
        lowConfidenceAction,
      } = config;
      const commission = { pricePercent, weightRate, fixedFee };

      // Сохраняем classify/interpret notes — они стабильны при смене страны; calculate
      // notes пересоздадим (breakdown, warning про default) ниже.
      const inputs: CalculatorInput[] = doc.resultData.map((r) => {
        const row = r as Record<string, unknown>;
        const notes = Array.isArray(row.notes)
          ? (row.notes as ProductNote[]).filter((n) => n.stage !== 'calculate')
          : [];
        const weightGross = toPositiveNumber(row.weightGross);
        return {
          description: String(row.description ?? ''),
          quantity: Number(row.quantity) || 1,
          price: Number(row.price) || 0,
          weight: Number(row.weight) || 0,
          ...(weightGross ? { weightGross } : {}),
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
          supplementaryUnit: (row.supplementaryUnit as string | null) ?? null,
          matchConfidence: Number(row.matchConfidence) || 0,
          matched: Boolean(row.matched ?? true),
          // legacy resultData без поля verified считаем проверенным (см. rowNeedsCodeReview):
          // такие документы уже прошли первичный pipeline и ревью.
          verified: Boolean(row.verified ?? true),
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
          supplementaryQuantity: item.supplementaryQuantity ?? null,
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
        return { ...base, ...buildRubFields(item, { exchangeRate, toRub }) };
      });

      // Пересчёт обязан проходить ту же проверку уверенности кодов, что и полный
      // pipeline: иначе документ из CODE_REVIEW_REQUIRED одним «Пересчитать»
      // молча становился PROCESSED с теми же низкоуверенными кодами.
      const issues = this.collectRowIssues(doc, summary.items, confidenceThreshold);
      const { hasRowErrors } = issues;

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
          lowConfidenceReasons: issues.reasons,
        },
        partial: summary.usedFallback,
      });

      await this.applyFinalStatusAndNotify(doc, issues, { lowConfidenceAction });

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
   * Заданный, но выпавший из расчёта фрахт (нет курса) — занижение таможенной стоимости:
   * помечаем warning-note на каждой строке, а не только в логах.
   * Внутренние warning'и (нулевой знаменатель и т. п.) логирует сам Calculator.
   */
  private buildFreightOption(
    doc: Document,
    products: ReadonlyArray<{
      weight: number;
      weightGross?: number;
      quantity: number;
      notes: ProductNote[];
    }>,
    currencyToDoc: Record<string, number>,
  ): { totalInDocCurrency: number; weightDenominator: number } | undefined {
    const total = resolveFreightTotalInDocCurrency(doc, currencyToDoc);
    if (total == null) {
      if (doc.freightCost && doc.freightCurrency) {
        this.logger.warn(
          `Document ${doc.id}: freight ${doc.freightCost} ${doc.freightCurrency} ignored — no rate to document currency ${doc.currency ?? '?'}`,
        );
        for (const p of products) {
          p.notes.push(freightIgnoredWarningNote(doc.freightCost, doc.freightCurrency));
        }
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


  /**
   * Сбор проблем по строкам рассчитанного документа: неполные расчёты (error/needs_info)
   * и строки, требующие ревью кода (unmatched / unverified / низкая уверенность).
   * Единая точка для полного pipeline и recalculate — критерии не должны расходиться.
   */
  private collectRowIssues(
    doc: Document,
    items: ReadonlyArray<{
      description: string;
      tnVedCode?: string;
      matchConfidence: number;
      matched: boolean;
      verified: boolean;
      calculationStatus: string;
    }>,
    confidenceThreshold: number,
  ): {
    hasRowErrors: boolean;
    reasons: string[];
  } {
    let hasRowErrors = false;
    const reasonsData: RejectionReasonData[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (isIncompleteCalculationStatus(item.calculationStatus)) hasRowErrors = true;
      if (rowNeedsCodeReview(item, confidenceThreshold)) {
        const original = (doc.parsedData?.[i] as { descriptionOriginal?: string } | undefined)
          ?.descriptionOriginal;
        reasonsData.push(buildLowConfidenceReasonData(i + 1, item, confidenceThreshold, original));
      }
    }
    return {
      hasRowErrors,
      reasons: reasonsData.map((d) => formatRejectionReason(d, 'ru')),
    };
  }

  /**
   * Финальный статус документа + уведомление. Общая ветка для process() и recalculate():
   * есть строки на ревью → CODE_REVIEW_REQUIRED (или REJECTED при lowConfidenceAction='reject'),
   * иначе PROCESSED / PROCESSED_WITH_ERRORS. Сбрасывает rejectionReasons, когда причин
   * больше нет (раньше устаревшие причины оставались висеть в БД).
   */
  private async applyFinalStatusAndNotify(
    doc: Document,
    issues: {
      hasRowErrors: boolean;
      reasons: string[];
    },
    opts: {
      lowConfidenceAction: string;
    },
  ): Promise<void> {
    if (issues.reasons.length > 0) {
      doc.rejectionReasons = issues.reasons;
      doc.status =
        opts.lowConfidenceAction === 'reject'
          ? DocumentStatus.REJECTED
          : DocumentStatus.CODE_REVIEW_REQUIRED;
      await this.repo.save(doc);
      await this.pipelineNotifier.notify(doc);
      return;
    }

    doc.rejectionReasons = null;
    doc.status = issues.hasRowErrors
      ? DocumentStatus.PROCESSED_WITH_ERRORS
      : DocumentStatus.PROCESSED;
    await this.repo.save(doc);
    // Списание депозита за успешно посчитанные позиции (идемпотентно, best-effort).
    await this.clientBalance.settle(doc);
    await this.pipelineNotifier.notify(doc);
  }
}
