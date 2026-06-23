import type { Job } from 'bullmq';
import type { CalculatedProduct, CalculationSummary } from '../calculator/calculator.service';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import type { ProductNote } from '../common/product-notes';
import {
  DEFAULT_COUNTRY_OF_ORIGIN,
  Document,
  DocumentStatus,
} from '../database/entities/document.entity';
import { DocumentsProcessor } from './documents.processor';
import { PipelineNotifierService } from './pipeline-notifier.service';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    telegramUserId: null,
    uploadedByUserId: null,
    originalFileName: 'test.xlsx',
    status: DocumentStatus.PENDING,
    currency: 'USD',
    exchangeRates: null,
    language: null,
    countryOfOrigin: null,
    countryOriginSource: null,
    countryDetectionReason: null,
    columnMapping: null,
    parsedData: [
      { description: 'Товар A', quantity: 10, price: 100, weight: 2 },
    ],
    resultData: null,
    rowCount: 1,
    errorMessage: null,
    rejectionReasons: null,
    tokenUsage: null,
    createdAt: new Date('2026-04-20T10:00:00Z'),
    updatedAt: new Date('2026-04-20T10:00:00Z'),
    telegramUser: null,
    uploadedBy: null,
    fileBuffer: null,
    ...overrides,
  });
  return doc;
}

function makeClassified(overrides: Partial<ClassifiedProduct> = {}): ClassifiedProduct {
  return {
    description: 'Товар A',
    quantity: 10,
    price: 100,
    weight: 2,
    tnVedCode: '0201100001',
    tnVedDescription: 'Мясо КРС',
    dutyRate: 15,
    dutyRateUnit: '%',
    dutySign: null,
    dutyMin: null,
    dutyMinUnit: null,
    vatRate: 20,
    exciseRate: 0,
    matchConfidence: 0.9,
    matched: true,
    verified: true,
    suggestedCode: null,
    verificationComment: '',
    notes: [],
    ...overrides,
  };
}

function makeCalculated(overrides: Partial<CalculatedProduct> = {}): CalculatedProduct {
  return {
    ...makeClassified(),
    totalPrice: 1000,
    freightShare: 0,
    dutyAmount: 150,
    dutyAmountIsEstimate: false,
    dutyFormula: null,
    dutyBase: null,
    dutyRateDisplay: '15%',
    vatAmount: 230,
    exciseAmount: 0,
    logisticsCommission: 50,
    totalCost: 1430,
    verificationStatus: 'exact',
    calculationStatus: 'exact',
    notes: [],
    ...overrides,
  };
}

function makeSummary(items: CalculatedProduct[]): CalculationSummary {
  return {
    items,
    totalDuty: items.reduce((s, i) => s + i.dutyAmount, 0),
    totalVat: items.reduce((s, i) => s + i.vatAmount, 0),
    totalExcise: items.reduce((s, i) => s + i.exciseAmount, 0),
    totalLogistics: items.reduce((s, i) => s + i.logisticsCommission, 0),
    totalFreight: items.reduce((s, i) => s + i.freightShare, 0),
    grandTotal: items.reduce((s, i) => s + i.totalCost, 0),
    usedFallback: items.some((i) => i.dutyAmountIsEstimate || i.calculationStatus !== 'exact'),
  };
}

/** Строка resultData в формате buildResultRow — для recalculate-тестов. */
function resultRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'A',
    quantity: 10,
    price: 100,
    weight: 2,
    tnVedCode: '0201100001',
    tnVedDescription: 'd',
    dutyRate: 15,
    vatRate: 20,
    exciseRate: 0,
    matched: true,
    verified: true,
    matchConfidence: 0.9,
    notes: [],
    dutyInterpretation: null,
    totalPrice: 1000,
    dutyAmount: 150,
    vatAmount: 230,
    exciseAmount: 0,
    logisticsCommission: 50,
    totalCost: 1430,
    calculationStatus: 'exact',
    ...overrides,
  };
}

interface Opts {
  doc?: Document;
  classifyResult?: {
    products: ClassifiedProduct[];
    tokenUsage: Record<string, unknown>;
    audit?: { searchQueries: string[][]; tksCandidates: unknown[][]; selections: unknown[] };
  };
  classifyError?: Error;
  interpretResult?: { products: ClassifiedProduct[]; tokenUsage: Record<string, unknown>; usedFallback?: boolean };
  interpretError?: Error;
  summary?: CalculationSummary;
  calculateError?: Error;
  config?: {
    pricePercent?: number;
    weightRate?: number;
    fixedFee?: number;
    sendResultFile?: boolean;
    confidenceThreshold?: number;
    lowConfidenceAction?: 'review' | 'reject';
  };
  rate?: number;
  rateError?: Error;
  calcLogError?: Error;
  balanceGate?: { allowed: boolean; need: number; available: number };
}

function createProcessor(opts: Opts = {}) {
  const doc = opts.doc ?? makeDoc();

  const repo = {
    findOne: jest.fn().mockResolvedValue(doc),
    save: jest.fn().mockImplementation((d: Document) => Promise.resolve(d)),
  };

  const classified = opts.classifyResult?.products ?? [makeClassified()];
  const makeDefaultAudit = (products: ClassifiedProduct[]) => ({
    searchQueries: products.map(() => [] as string[]),
    tksCandidates: products.map(() => [] as unknown[]),
    selections: products.map(() => null),
  });
  const classifier = {
    classify: jest.fn().mockImplementation(() => {
      if (opts.classifyError) return Promise.reject(opts.classifyError);
      if (opts.classifyResult) {
        return Promise.resolve({
          ...opts.classifyResult,
          audit: opts.classifyResult.audit ?? makeDefaultAudit(opts.classifyResult.products),
          usedFallback: opts.classifyResult.products.some((p) => !p.matched || !p.verified),
        });
      }
      return Promise.resolve({
        products: classified,
        tokenUsage: {},
        audit: makeDefaultAudit(classified),
        usedFallback: classified.some((p) => !p.matched || !p.verified),
      });
    }),
  };

  const dutyInterpreter = {
    interpret: jest.fn().mockImplementation((products: ClassifiedProduct[]) => {
      if (opts.interpretError) return Promise.reject(opts.interpretError);
      return Promise.resolve(
        opts.interpretResult ?? {
          products: products.map((p) => ({ ...p, dutyInterpretation: null })),
          tokenUsage: {},
          usedFallback: false,
        },
      );
    }),
  };

  const calculator = {
    calculate: jest.fn().mockImplementation(() => {
      if (opts.calculateError) throw opts.calculateError;
      return opts.summary ?? makeSummary([makeCalculated()]);
    }),
  };

  const configService = {
    get: jest.fn().mockResolvedValue({
      pricePercent: 5,
      weightRate: 2,
      fixedFee: 10,
      sendResultFile: true,
      confidenceThreshold: 0.8,
      lowConfidenceAction: 'review',
      ...opts.config,
    }),
  };

  const currencyService = {
    getRate: jest.fn().mockImplementation((cur: string) => {
      if (opts.rateError) return Promise.reject(opts.rateError);
      if (cur === 'USD') return Promise.resolve(opts.rate ?? 90);
      if (cur === 'EUR') return Promise.resolve(100);
      if (cur === 'CNY') return Promise.resolve(12);
      if (cur === 'INR') return Promise.resolve(1.1);
      return Promise.resolve(opts.rate ?? 90);
    }),
    toRubSync: jest.fn().mockImplementation((v: number, rate: number) => v * rate),
    buildCurrencyToDocRates: jest.fn().mockResolvedValue({}),
  };

  const calculationLogs = {
    create: jest.fn().mockImplementation(() => {
      if (opts.calcLogError) return Promise.reject(opts.calcLogError);
      return Promise.resolve(undefined);
    }),
  };

  const audit = {
    startStageRun: jest.fn().mockResolvedValue('stage-run-id'),
    completeStageRun: jest.fn().mockResolvedValue(undefined),
    failStageRun: jest.fn().mockResolvedValue(undefined),
    recordAiCall: jest.fn().mockResolvedValue(undefined),
    recordDocumentVersion: jest.fn().mockResolvedValue(1),
  };

  const regulatoryService = {
    buildReport: jest.fn().mockResolvedValue({
      certifications: [],
      permits: [],
      licenses: [],
      marking: [],
      traceability: [],
      utilizationFee: [],
      strategicAndDualUse: [],
      countryRestrictions: [],
      other: [],
      totalCount: 0,
    }),
  };

  const managerNotify = {
    notifyDocumentEvent: jest.fn().mockResolvedValue(undefined),
  };

  // Реальный нотификатор поверх мок-менеджера: managed-документ → notifyDocumentEvent,
  // self_service → no-op (после удаления tg-bot self_service-уведомлений нет).
  const pipelineNotifier = new PipelineNotifierService(managerNotify as any);

  const clientBalance = {
    checkProcessingAllowed: jest
      .fn()
      .mockResolvedValue(opts.balanceGate ?? { allowed: true, need: 0, available: 0 }),
    settle: jest.fn().mockResolvedValue(undefined),
  };

  const processor = new DocumentsProcessor(
    repo as any,
    classifier as any,
    calculator as any,
    configService as any,
    dutyInterpreter as any,
    currencyService as any,
    calculationLogs as any,
    audit as any,
    regulatoryService as any,
    pipelineNotifier as any,
    clientBalance as any,
  );

  return {
    processor,
    doc,
    repo,
    managerNotify,
    clientBalance,
    classifier,
    dutyInterpreter,
    calculator,
    configService,
    currencyService,
    calculationLogs,
    audit,
  };
}

function fakeJob(documentId: string, name = 'process-document'): Job<{ documentId: string }> {
  return { name, data: { documentId }, attemptsMade: 0, id: 'job-1' } as any;
}

describe('DocumentsProcessor.process', () => {
  describe('базовый flow', () => {
    it('document not found → просто warn и return, save не вызывается', async () => {
      const { processor, repo } = createProcessor();
      repo.findOne.mockResolvedValueOnce(null);

      await processor.process(fakeJob('missing'));

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: classify → interpret → calculate → PROCESSED + notify', async () => {
      const tgUser = { telegramId: '123', username: 'u', language: null };
      const doc = makeDoc({ telegramUser: tgUser as any });
      const { processor, repo, classifier, dutyInterpreter, calculator } =
        createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(classifier.classify).toHaveBeenCalledTimes(1);
      expect(dutyInterpreter.interpret).toHaveBeenCalledTimes(1);
      expect(calculator.calculate).toHaveBeenCalledTimes(1);
      expect(doc.status).toBe(DocumentStatus.PROCESSED);
      // save: PROCESSING → PROCESSED
      expect(repo.save).toHaveBeenCalled();
    });

    it('устанавливает status=PROCESSING до обработки, потом PROCESSED', async () => {
      const doc = makeDoc();
      const statuses: DocumentStatus[] = [];
      const { processor, repo } = createProcessor({ doc });
      repo.save.mockImplementation((d: Document) => {
        statuses.push(d.status);
        return Promise.resolve(d);
      });

      await processor.process(fakeJob('doc-1'));

      expect(statuses[0]).toBe(DocumentStatus.PROCESSING);
      expect(statuses[statuses.length - 1]).toBe(DocumentStatus.PROCESSED);
    });

    it('строка с calculationStatus=error → PROCESSED_WITH_ERRORS', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const summary = makeSummary([
        makeCalculated({ calculationStatus: 'error' }),
      ]);
      const { processor } = createProcessor({ doc, summary });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED_WITH_ERRORS);
    });
  });

  describe('low confidence', () => {
    it('unverified строка (Claude не отработал) с высоким TKS-confidence → CODE_REVIEW_REQUIRED', async () => {
      // calcProbability TKS-поиска легко даёт ≥0.8 — это частотность кода в выдаче,
      // а не качество матча. Без verified-критерия такая строка уходила в PROCESSED.
      const item = makeCalculated({ verified: false, matchConfidence: 0.95, matched: true });
      const { processor, doc } = createProcessor({
        summary: makeSummary([item]),
        config: { lowConfidenceAction: 'review' },
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.CODE_REVIEW_REQUIRED);
      expect(doc.rejectionReasons?.[0]).toContain('без AI-проверки');
    });

    it('строка с calculationStatus=needs_info → PROCESSED_WITH_ERRORS, не «чистый» PROCESSED', async () => {
      const item = makeCalculated({ calculationStatus: 'needs_info' });
      const { processor, doc } = createProcessor({ summary: makeSummary([item]) });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED_WITH_ERRORS);
    });

    it('lowConfidenceAction=review → CODE_REVIEW_REQUIRED + rejectionReasons', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const summary = makeSummary([
        makeCalculated({ matchConfidence: 0.5, tnVedCode: '0201100001' }),
      ]);
      const { processor } = createProcessor({
        doc,
        summary,
        config: { lowConfidenceAction: 'review', confidenceThreshold: 0.8 },
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.CODE_REVIEW_REQUIRED);
      expect(doc.rejectionReasons).toBeDefined();
      expect(doc.rejectionReasons!.length).toBe(1);
      expect(doc.rejectionReasons![0]).toContain('не уверена в коде');
    });

    it('lowConfidenceAction=reject → REJECTED + rejectionReasons', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const summary = makeSummary([
        makeCalculated({ matched: false, tnVedCode: '', matchConfidence: 0 }),
      ]);
      const { processor } = createProcessor({
        doc,
        summary,
        config: { lowConfidenceAction: 'reject', confidenceThreshold: 0.8 },
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.REJECTED);
      expect(doc.rejectionReasons).toBeDefined();
      expect(doc.rejectionReasons![0]).toContain('не удалось подобрать код');
    });

    it('смешанный результат (1 low-conf + 1 ok) → блок на обеих (есть хотя бы одна low-conf)', async () => {
      const doc = makeDoc();
      const summary = makeSummary([
        makeCalculated({ matchConfidence: 0.9 }),
        makeCalculated({ matchConfidence: 0.5, description: 'B' }),
      ]);
      const { processor } = createProcessor({ doc, summary });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.CODE_REVIEW_REQUIRED);
      expect(doc.rejectionReasons!.length).toBe(1);
    });
  });

  describe('игнорируемый фрахт', () => {
    it('freightCost задан, но курса нет → warning-note про фрахт в каждой строке', async () => {
      // buildCurrencyToDocRates в моке возвращает {} — курса USD→USD нет вообще,
      // resolveFreightTotalInDocCurrency даст null, фрахт выпадает из расчёта.
      const doc = makeDoc({ freightCost: 500, freightCurrency: 'USD' } as Partial<Document>);
      const { processor, calculator } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      const [products, , options] = calculator.calculate.mock.calls[0];
      expect(options.freight).toBeUndefined();
      const freightNotes = (products[0].notes as ProductNote[]).filter(
        (n) => n.field === 'freight' && n.severity === 'warning',
      );
      expect(freightNotes).toHaveLength(1);
      expect(freightNotes[0].message).toContain('не включён в расчёт');
    });
  });

  describe('обработка ошибок', () => {
    it('classify бросает → FAILED + errorMessage', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor } = createProcessor({
        doc,
        classifyError: new Error('Classify failed'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Classify failed');
    });

    it('interpret бросает → FAILED', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        interpretError: new Error('Interpret fail'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Interpret fail');
    });

    it('calculate бросает → FAILED', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        calculateError: new Error('Calc fail'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Calc fail');
    });

    it('Error с пустым message → errorMessage="Unknown error"', async () => {
      const doc = makeDoc();
      const emptyErr = new Error('');
      const { processor } = createProcessor({
        doc,
        classifyError: emptyErr,
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Unknown error');
    });
  });

  describe('валютная конвертация', () => {
    it('currency=RUB → не зовёт getRate для USD, resultData без RUB-дублей', async () => {
      const doc = makeDoc({ currency: 'RUB' });
      const { processor, currencyService } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      const docCurRateCalls = currencyService.getRate.mock.calls.filter((c) => c[0] === 'RUB');
      expect(docCurRateCalls).toHaveLength(0);
      const firstRow = doc.resultData![0] as Record<string, unknown>;
      expect(firstRow.totalCostRub).toBeUndefined();
      expect(firstRow.exchangeRate).toBeUndefined();
    });

    it('currency=USD → добавляет totalCostRub, dutyAmountRub и exchangeRate в каждую строку', async () => {
      const doc = makeDoc({ currency: 'USD' });
      const { processor } = createProcessor({ doc, rate: 90 });

      await processor.process(fakeJob('doc-1'));

      const firstRow = doc.resultData![0] as Record<string, unknown>;
      expect(firstRow.totalCostRub).toBe(1430 * 90);
      expect(firstRow.dutyAmountRub).toBe(150 * 90);
      expect(firstRow.vatAmountRub).toBe(230 * 90);
      expect(firstRow.exchangeRate).toBe(90);
    });

    it('сохраняет exchangeRates для популярных валют', async () => {
      const doc = makeDoc({ currency: 'USD' });
      const { processor } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.exchangeRates).toEqual(
        expect.objectContaining({
          RUB: 1,
          USD: 90,
          EUR: 100,
          CNY: 12,
          INR: 1.1,
        }),
      );
    });
  });

  describe('страна происхождения', () => {
    it('countryOfOrigin=null → ставит дефолтный Китай и source=default', async () => {
      const doc = makeDoc({ countryOfOrigin: null });
      const { processor } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.countryOfOrigin).toBe(DEFAULT_COUNTRY_OF_ORIGIN);
      expect(doc.countryOriginSource).toBe('default');
      expect(doc.countryDetectionReason).toContain('Китай');
    });

    it('countryOriginSource=default → добавляет warning note в каждый товар', async () => {
      const doc = makeDoc({ countryOfOrigin: null });
      const { processor, calculator } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      const calcCallArg = calculator.calculate.mock.calls[0][0] as Array<{ notes: ProductNote[] }>;
      const note = calcCallArg[0].notes.find((n) => n.field === 'country');
      expect(note).toBeDefined();
      expect(note!.severity).toBe('warning');
    });

    it('countryOfOrigin=manual → не затирается, note не добавляется', async () => {
      const doc = makeDoc({
        countryOfOrigin: '840',
        countryOriginSource: 'manual',
      });
      const { processor, calculator } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.countryOfOrigin).toBe('840');
      expect(doc.countryOriginSource).toBe('manual');
      const calcCallArg = calculator.calculate.mock.calls[0][0] as Array<{ notes: ProductNote[] }>;
      const hasCountryNote = calcCallArg[0].notes.some((n) => n.field === 'country');
      expect(hasCountryNote).toBe(false);
    });

    it('передаёт countryOfOrigin в calculator', async () => {
      const doc = makeDoc({ countryOfOrigin: '840', countryOriginSource: 'manual' });
      const { processor, calculator } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(calculator.calculate).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({ countryOfOrigin: '840' }),
      );
    });
  });

  describe('язык', () => {
    it('использует doc.language если задан', async () => {
      const doc = makeDoc({
        language: 'en',
        telegramUser: { telegramId: '123', language: 'zh' } as any,
      });
      const { processor, classifier, dutyInterpreter } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(classifier.classify).toHaveBeenCalledWith(
        expect.any(Array),
        'en',
        expect.any(Number),
        expect.objectContaining({ documentId: 'doc-1' }),
      );
      expect(dutyInterpreter.interpret).toHaveBeenCalledWith(
        expect.any(Array),
        'en',
        expect.objectContaining({ documentId: 'doc-1' }),
      );
    });

    it('fallback на telegramUser.language если doc.language не задан', async () => {
      const doc = makeDoc({
        language: null,
        telegramUser: { telegramId: '123', language: 'zh' } as any,
      });
      const { processor, classifier } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(classifier.classify).toHaveBeenCalledWith(
        expect.any(Array),
        'zh',
        expect.any(Number),
        expect.objectContaining({ documentId: 'doc-1' }),
      );
    });

    it('без language и без telegramUser — передаёт undefined', async () => {
      const doc = makeDoc({ language: null, telegramUser: null });
      const { processor, classifier } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(classifier.classify).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        expect.any(Number),
        expect.objectContaining({ documentId: 'doc-1' }),
      );
    });
  });

  describe('notifications', () => {
    it('self_service-документ → менеджеру не уведомляем (после удаления tg-bot)', async () => {
      const doc = makeDoc({ source: 'self_service', telegramUser: { telegramId: '123' } as any });
      const { processor, managerNotify } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED);
      expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
    });

    it('managed-документ → уведомляем менеджера на терминальном статусе', async () => {
      const doc = makeDoc({ source: 'managed', telegramUser: { telegramId: '123' } as any });
      const { processor, managerNotify } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED);
      expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
    });
  });

  describe('депозит клиента', () => {
    it('недостаточно баланса → FAILED, обработка не запускается, settle не вызывается', async () => {
      const doc = makeDoc({
        telegramUserId: 'tg-1',
        source: 'managed',
        telegramUser: { telegramId: '123' } as any,
      });
      const { processor, classifier, clientBalance, managerNotify } = createProcessor({
        doc,
        balanceGate: { allowed: false, need: 1, available: 0 },
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toContain('Недостаточно баланса');
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(clientBalance.settle).not.toHaveBeenCalled();
      // managed-документ → менеджер получает уведомление об ошибке
      expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
    });

    it('успешная обработка → settle(doc) вызывается', async () => {
      const doc = makeDoc({ telegramUserId: 'tg-1', telegramUser: { telegramId: '123' } as any });
      const { processor, clientBalance } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED);
      expect(clientBalance.settle).toHaveBeenCalledWith(doc);
    });

    it('документ без клиента (загрузка из админки) — гейт пропускает, settle вызывается (no-op внутри)', async () => {
      const doc = makeDoc({ telegramUserId: null });
      const { processor, clientBalance } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PROCESSED);
      expect(clientBalance.checkProcessingAllowed).toHaveBeenCalled();
      expect(clientBalance.settle).toHaveBeenCalledWith(doc);
    });
  });

  describe('calculation log', () => {
    it('пишет лог с trigger=full', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123', username: 'u' } as any });
      const { processor, calculationLogs } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(calculationLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          telegramUserId: '123',
          telegramUsername: 'u',
          trigger: 'full',
          itemsCount: 1,
        }),
      );
    });

    it('ошибка лога не ломает процесс', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        calcLogError: new Error('log db down'),
      });

      await processor.process(fakeJob('doc-1'));

      // Процесс дошёл до конца
      expect(doc.status).toBe(DocumentStatus.PROCESSED);
    });
  });

  describe('parsedData mapping', () => {
    it('маппит строки parsedData в ProductRow с дефолтами', async () => {
      const doc = makeDoc({
        parsedData: [
          { description: 'A', quantity: 5, price: 100, weight: 1 },
          // Missing fields → defaults
          { description: 'B' },
          // Numeric strings
          { description: 'C', quantity: '3', price: '50', weight: '0.5' } as any,
        ],
      });
      const { processor, classifier } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      const rows = classifier.classify.mock.calls[0][0] as Array<{
        description: string;
        quantity: number;
        price: number;
        weight: number;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ description: 'A', quantity: 5, price: 100, weight: 1 });
      expect(rows[1]).toMatchObject({ description: 'B', quantity: 1, price: 0, weight: 0 });
      expect(rows[2]).toMatchObject({ description: 'C', quantity: 3, price: 50, weight: 0.5 });
    });

    it('пробрасывает hsCode и rawContext из parsedData', async () => {
      const doc = makeDoc({
        parsedData: [
          {
            description: 'A',
            quantity: 1,
            price: 100,
            weight: 1,
            hsCode: '1234567890',
            rawContext: 'material: steel',
          },
        ],
      });
      const { processor, classifier } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      const rows = classifier.classify.mock.calls[0][0] as Array<any>;
      expect(rows[0].hsCode).toBe('1234567890');
      expect(rows[0].rawContext).toBe('material: steel');
    });
  });

  describe('tokenUsage', () => {
    it('аккумулирует usage по стадиям', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        classifyResult: {
          products: [makeClassified()],
          tokenUsage: {
            'claude-sonnet': { inputTokens: 100, outputTokens: 50 },
          },
        },
        interpretResult: {
          products: [{ ...makeClassified(), dutyInterpretation: null } as any],
          tokenUsage: {
            'claude-opus': { inputTokens: 200, outputTokens: 80 },
          },
        },
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.tokenUsage).toBeDefined();
      expect(doc.tokenUsage!.classifier).toEqual(
        expect.objectContaining({
          'claude-sonnet': expect.objectContaining({ inputTokens: 100, outputTokens: 50 }),
        }),
      );
      expect(doc.tokenUsage!.interpreter).toEqual(
        expect.objectContaining({
          'claude-opus': expect.objectContaining({ inputTokens: 200, outputTokens: 80 }),
        }),
      );
    });
  });
});

describe('DocumentsProcessor.recalculate (job.name="recalculate-document")', () => {
  it('без resultData → warn return, save не вызывается', async () => {
    const doc = makeDoc({ resultData: null });
    const { processor, repo } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('не зовёт classifier/interpreter — использует сохранённые dutyInterpretation', async () => {
    const doc = makeDoc({
      resultData: [
        {
          description: 'A',
          quantity: 10,
          price: 100,
          weight: 2,
          tnVedCode: '0201100001',
          tnVedDescription: 'd',
          dutyRate: 15,
          vatRate: 20,
          exciseRate: 0,
          matched: true,
          matchConfidence: 0.9,
          notes: [],
          dutyInterpretation: null,
          totalPrice: 1000,
          dutyAmount: 150,
          vatAmount: 230,
          exciseAmount: 0,
          logisticsCommission: 50,
          totalCost: 1430,
          calculationStatus: 'exact',
        },
      ],
    });
    const { processor, classifier, dutyInterpreter, calculator } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(dutyInterpreter.interpret).not.toHaveBeenCalled();
    expect(calculator.calculate).toHaveBeenCalledTimes(1);
    expect(doc.status).toBe(DocumentStatus.PROCESSED);
  });

  it('низкоуверенная строка → CODE_REVIEW_REQUIRED, а не PROCESSED (обход ревью закрыт)', async () => {
    // Документ ушёл в CODE_REVIEW_REQUIRED, оператор жмёт «Пересчитать» с другой страной —
    // коды всё ещё низкоуверенные, документ обязан остаться на ревью.
    // Реальный flow: service.recalculate ставит PENDING перед постановкой job.
    const doc = makeDoc({
      status: DocumentStatus.PENDING,
      rejectionReasons: ['старая причина'],
      resultData: [resultRow({ matchConfidence: 0.4 })],
      telegramUser: { telegramId: '123', language: 'ru' } as never,
    });
    const lowConfItem = makeCalculated({ matchConfidence: 0.4 });
    const { processor } = createProcessor({
      doc,
      summary: makeSummary([lowConfItem]),
    });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(doc.status).toBe(DocumentStatus.CODE_REVIEW_REQUIRED);
    expect(doc.rejectionReasons?.length).toBeGreaterThan(0);
    expect(doc.rejectionReasons?.[0]).not.toBe('старая причина');
  });

  it('lowConfidenceAction=reject → REJECTED при пересчёте', async () => {
    const doc = makeDoc({
      status: DocumentStatus.PENDING,
      resultData: [resultRow({ matchConfidence: 0.4 })],
    });
    const { processor } = createProcessor({
      doc,
      summary: makeSummary([makeCalculated({ matchConfidence: 0.4 })]),
      config: { lowConfidenceAction: 'reject' },
    });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(doc.status).toBe(DocumentStatus.REJECTED);
  });

  it('чистый пересчёт сбрасывает устаревшие rejectionReasons', async () => {
    const doc = makeDoc({
      status: DocumentStatus.PENDING,
      rejectionReasons: ['строка 1 — низкая уверенность'],
      resultData: [resultRow()],
    });
    const { processor } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(doc.status).toBe(DocumentStatus.PROCESSED);
    expect(doc.rejectionReasons).toBeNull();
  });

  it('legacy resultData без поля verified не уводится в ревью (verified ?? true)', async () => {
    const row = resultRow();
    delete (row as Record<string, unknown>).verified;
    const doc = makeDoc({ status: DocumentStatus.PENDING, resultData: [row] });
    const { processor, calculator } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    const [products] = calculator.calculate.mock.calls[0];
    expect(products[0].verified).toBe(true);
    expect(doc.status).toBe(DocumentStatus.PROCESSED);
  });

  it('ошибка calculate → FAILED (без notify)', async () => {
    const doc = makeDoc({
      resultData: [
        {
          description: 'A',
          quantity: 1,
          price: 100,
          weight: 1,
          tnVedCode: '0201',
          tnVedDescription: '',
          dutyRate: 0,
          vatRate: 20,
          exciseRate: 0,
          matched: true,
          matchConfidence: 0.9,
          notes: [],
          dutyInterpretation: null,
          totalPrice: 100,
          dutyAmount: 0,
          vatAmount: 20,
          exciseAmount: 0,
          logisticsCommission: 5,
          totalCost: 125,
          calculationStatus: 'exact',
        },
      ],
    });
    const { processor, managerNotify } = createProcessor({
      doc,
      calculateError: new Error('recalc fail'),
    });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(doc.status).toBe(DocumentStatus.FAILED);
    expect(doc.errorMessage).toBe('recalc fail');
    // recalculate не отправляет failed-notification
    expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('пишет calculation log с trigger=recalculate', async () => {
    const doc = makeDoc({
      telegramUser: { telegramId: '123', username: 'u' } as any,
      resultData: [
        {
          description: 'A',
          quantity: 1,
          price: 100,
          weight: 1,
          tnVedCode: '0201',
          tnVedDescription: '',
          dutyRate: 0,
          vatRate: 20,
          exciseRate: 0,
          matched: true,
          matchConfidence: 0.9,
          notes: [],
          dutyInterpretation: null,
          totalPrice: 100,
          dutyAmount: 0,
          vatAmount: 20,
          exciseAmount: 0,
          logisticsCommission: 5,
          totalCost: 125,
          calculationStatus: 'exact',
        },
      ],
    });
    const { processor, calculationLogs } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    expect(calculationLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'recalculate' }),
    );
  });

  it('фильтрует calculate-notes из сохранённых resultData перед пересчётом', async () => {
    const doc = makeDoc({
      resultData: [
        {
          description: 'A',
          quantity: 1,
          price: 100,
          weight: 1,
          tnVedCode: '0201',
          tnVedDescription: '',
          dutyRate: 0,
          vatRate: 20,
          exciseRate: 0,
          matched: true,
          matchConfidence: 0.9,
          notes: [
            { stage: 'classify', severity: 'info', message: 'keep' },
            { stage: 'calculate', severity: 'info', message: 'drop' },
          ],
          dutyInterpretation: null,
          totalPrice: 100,
          dutyAmount: 0,
          vatAmount: 20,
          exciseAmount: 0,
          logisticsCommission: 5,
          totalCost: 125,
          calculationStatus: 'exact',
        },
      ],
    });
    const { processor, calculator } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1', 'recalculate-document'));

    const inputs = calculator.calculate.mock.calls[0][0] as Array<{ notes: ProductNote[] }>;
    expect(inputs[0].notes.map((n) => n.stage)).toEqual(['classify']);
    expect(inputs[0].notes.find((n) => n.message === 'drop')).toBeUndefined();
  });
});

describe('DocumentsProcessor partial_ok flag', () => {
  it('все стадии ok → completeStageRun вызывается с partial=false (или без флага)', async () => {
    const doc = makeDoc({ countryOfOrigin: '156', countryOriginSource: 'ai_explicit' });
    const classified = [makeClassified()];
    const { processor, audit } = createProcessor({
      doc,
      classifyResult: { products: classified, tokenUsage: {} },
      interpretResult: { products: classified, tokenUsage: {}, usedFallback: false },
      summary: makeSummary([makeCalculated()]),
    });

    await processor.process(fakeJob('doc-1'));

    const calls = audit.completeStageRun.mock.calls;
    for (const [, input] of calls) {
      expect(input?.partial ?? false).toBe(false);
    }
  });

  it('classify.usedFallback=true → стадия classify помечается partial=true', async () => {
    const unmatched = makeClassified({ matched: false });
    const { processor, audit } = createProcessor({
      classifyResult: { products: [unmatched], tokenUsage: {} },
      interpretResult: { products: [unmatched], tokenUsage: {}, usedFallback: false },
      summary: makeSummary([makeCalculated({ matched: false })]),
    });

    await processor.process(fakeJob('doc-1'));

    // Порядок вызовов: classify → interpret → calculate → далее notify
    const partialFlags = audit.completeStageRun.mock.calls.map(([, input]) => input?.partial ?? false);
    expect(partialFlags[0]).toBe(true); // classify
  });

  it('interpret.usedFallback=true → стадия interpret помечается partial=true', async () => {
    const { processor, audit } = createProcessor({
      interpretResult: {
        products: [makeClassified({ matched: true, verified: true })],
        tokenUsage: {},
        usedFallback: true,
      },
    });

    await processor.process(fakeJob('doc-1'));

    const partialFlags = audit.completeStageRun.mock.calls.map(([, input]) => input?.partial ?? false);
    expect(partialFlags[0]).toBe(false); // classify — по дефолту matched=true, verified=true
    expect(partialFlags[1]).toBe(true); // interpret
  });

  it('calculate.usedFallback=true (estimate/non-exact) → стадия calculate помечается partial=true', async () => {
    const { processor, audit } = createProcessor({
      summary: makeSummary([makeCalculated({ dutyAmountIsEstimate: true, calculationStatus: 'needs_info' })]),
    });

    await processor.process(fakeJob('doc-1'));

    const partialFlags = audit.completeStageRun.mock.calls.map(([, input]) => input?.partial ?? false);
    expect(partialFlags[2]).toBe(true); // calculate
  });

  it('fallback-страна Китай (countryOriginSource=default) сама по себе НЕ делает calculate partial', async () => {
    const doc = makeDoc({ countryOfOrigin: null, countryOriginSource: null });
    const { processor, audit } = createProcessor({ doc });

    await processor.process(fakeJob('doc-1'));

    // После processor'а countryOriginSource станет 'default', но это не повод для partial.
    expect(doc.countryOriginSource).toBe('default');
    const partialFlags = audit.completeStageRun.mock.calls.map(([, input]) => input?.partial ?? false);
    expect(partialFlags[2]).toBe(false); // calculate
  });
});
