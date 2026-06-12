import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/error-codes';
import { DocumentStatus } from '../database/entities/document.entity';
import { ManualCodeService } from './manual-code.service';

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    status: DocumentStatus.CODE_REVIEW_REQUIRED,
    language: 'ru',
    currency: 'USD',
    countryOfOrigin: null,
    freightCost: null,
    freightCurrency: null,
    parsedData: [
      { description: 'foo', quantity: 1, price: 10, weight: 0.5 },
    ],
    resultData: [
      {
        description: 'foo',
        quantity: 1,
        price: 10,
        weight: 0.5,
        tnVedCode: '',
        matchConfidence: 0,
        matched: false,
      },
    ],
    rejectionReasons: ['stale auto reason'],
    telegramUser: { telegramId: '12345', username: 'tester', language: 'ru' },
    originalFileName: 'goods.xlsx',
    tokenUsage: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  };
}

function makeTnved(code = '6109100010') {
  return {
    CODE: code,
    KR_NAIM: 'Футболки',
    TNVED: { IMP: 12.5, NDS: 20, AKC: 0 },
    TNVEDALL: [],
  };
}

interface CreateOpts {
  doc?: ReturnType<typeof makeDoc> | null;
  tnved?: ReturnType<typeof makeTnved> | null;
  tnvedError?: Error;
}

function createService(opts: CreateOpts = {}) {
  const doc = opts.doc === undefined ? makeDoc() : opts.doc;

  // applyRowUpdate перечитывает документ под локом в транзакции — мок возвращает
  // тот же repo, чтобы ассерты на findOne/update видели и транзакционные вызовы.
  const repo: Record<string, unknown> = {
    findOne: jest.fn().mockResolvedValue(doc),
    save: jest.fn().mockImplementation(async (d) => d),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  repo.manager = {
    transaction: jest.fn().mockImplementation(async (cb: (em: unknown) => unknown) =>
      cb({ getRepository: () => repo }),
    ),
  };

  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const tksApi = {
    getTnvedCode: jest.fn().mockImplementation(async (code: string) => {
      if (opts.tnvedError) throw opts.tnvedError;
      return opts.tnved ?? makeTnved(code);
    }),
  };

  const classifier = {
    classify: jest.fn().mockResolvedValue({
      products: [
        {
          description: 'foo',
          quantity: 1,
          price: 10,
          weight: 0.5,
          tnVedCode: '6109100010',
          tnVedDescription: 'Футболки',
          dutyRate: 12.5,
          dutyRateUnit: null,
          dutySign: null,
          dutyMin: null,
          dutyMinUnit: null,
          vatRate: 20,
          exciseRate: 0,
          matchConfidence: 0.9,
          matched: true,
          tnvedRaw: opts.tnved ?? makeTnved(),
          verified: true,
          suggestedCode: null,
          verificationComment: 'ok',
          notes: [],
        },
      ],
      tokenUsage: {},
      audit: { searchQueries: [], tksCandidates: [], selections: [] },
      usedFallback: false,
    }),
  };

  const dutyInterpreter = {
    interpret: jest.fn().mockImplementation(async (products: unknown[]) => ({
      products,
      tokenUsage: {},
    })),
  };

  const calculator = {
    calculate: jest.fn().mockImplementation((products: unknown[]) => ({
      items: (products as Array<Record<string, unknown>>).map((p) => ({
        ...p,
        totalPrice: 10,
        dutyAmount: 1.25,
        vatAmount: 2.25,
        exciseAmount: 0,
        logisticsCommission: 0,
        freightShare: 0,
        totalCost: 13.5,
        verificationStatus: 'exact',
      })),
      totals: {
        grandTotal: 13.5,
        totalDuty: 1.25,
        totalVat: 2.25,
        totalExcise: 0,
        totalLogistics: 0,
        totalFreight: 0,
      },
    })),
  };

  const currencyService = {
    buildCurrencyToDocRates: jest.fn().mockResolvedValue({ USD: 1, RUB: 0.01 }),
    getRate: jest.fn().mockResolvedValue(90),
    toRubSync: jest.fn().mockImplementation((v: number, rate: number) => v * rate),
  };

  const configService = {
    get: jest.fn().mockResolvedValue({
      pricePercent: 0,
      weightRate: 0,
      fixedFee: 0,
      confidenceThreshold: 0.7,
      lowConfidenceAction: 'review',
      sendResultFile: true,
    }),
  };

  const calculationLogs = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const regulatoryService = {
    buildReport: jest.fn().mockResolvedValue(null),
  };

  const managerNotify = {
    notifyDocumentEvent: jest.fn().mockResolvedValue(undefined),
    notifyNewDocument: jest.fn().mockResolvedValue(undefined),
    notifyClientMessage: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ManualCodeService(
    repo as never,
    notificationQueue as never,
    tksApi as never,
    classifier as never,
    dutyInterpreter as never,
    calculator as never,
    currencyService as never,
    configService as never,
    calculationLogs as never,
    regulatoryService as never,
    managerNotify as never,
  );

  return {
    service,
    repo,
    notificationQueue,
    tksApi,
    classifier,
    dutyInterpreter,
    calculator,
    calculationLogs,
    regulatoryService,
  };
}

describe('ManualCodeService', () => {
  describe('setRowCode', () => {
    it('throws NotFoundException when document is missing', async () => {
      const { service } = createService({ doc: null });
      await expect(service.setRowCode('missing', 0, '6109100010')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects status that is not code_review_required / processed_with_errors', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED }),
      });
      await expect(service.setRowCode('doc-1', 0, '6109100010')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_SET_CODE },
      });
    });

    it('rejects rowIndex out of range with UNKNOWN_ROW', async () => {
      const { service } = createService();
      await expect(service.setRowCode('doc-1', 99, '6109100010')).rejects.toMatchObject({
        response: { code: ErrorCode.UNKNOWN_ROW },
      });
      await expect(service.setRowCode('doc-1', -1, '6109100010')).rejects.toMatchObject({
        response: { code: ErrorCode.UNKNOWN_ROW },
      });
    });

    it('rejects unknown TKS code with UNKNOWN_TNVED_CODE', async () => {
      const { service } = createService({
        tnvedError: new Error('TKS 404'),
      });
      await expect(service.setRowCode('doc-1', 0, '9999999999')).rejects.toMatchObject({
        response: { code: ErrorCode.UNKNOWN_TNVED_CODE },
      });
    });

    it('updates the row, flips status to PROCESSED, clears rejectionReasons, queues notification', async () => {
      const { service, repo, notificationQueue, regulatoryService, calculationLogs } =
        createService();
      const result = await service.setRowCode('doc-1', 0, '6109100010');

      expect(repo.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          status: DocumentStatus.PROCESSED,
          rejectionReasons: null,
        }),
      );
      expect(regulatoryService.buildReport).toHaveBeenCalled();
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({ status: 'processed', documentId: 'doc-1' }),
      );
      expect(calculationLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', trigger: 'recalculate' }),
      );
      expect(result.status).toBe(DocumentStatus.PROCESSED);
    });

    it('reuses the dutyInterpreter cache: one batch of one product', async () => {
      const { service, dutyInterpreter } = createService();
      await service.setRowCode('doc-1', 0, '6109100010');
      expect(dutyInterpreter.interpret).toHaveBeenCalledTimes(1);
      expect(dutyInterpreter.interpret).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ tnVedCode: '6109100010' })]),
        'ru',
      );
    });

    it('continues without regulatory report when buildReport throws', async () => {
      const { service, repo, regulatoryService } = createService();
      regulatoryService.buildReport.mockRejectedValueOnce(new Error('TKS down'));
      const result = await service.setRowCode('doc-1', 0, '6109100010');
      expect(result.status).toBe(DocumentStatus.PROCESSED);
      expect(repo.update).toHaveBeenCalled();
    });
  });

  describe('clarifyRow', () => {
    it('rejects empty userNote with USER_NOTE_TOO_SHORT', async () => {
      const { service } = createService();
      await expect(service.clarifyRow('doc-1', 0, '   ')).rejects.toMatchObject({
        response: { code: ErrorCode.USER_NOTE_TOO_SHORT },
      });
    });

    it('throws NotFoundException when document is missing', async () => {
      const { service } = createService({ doc: null });
      await expect(service.clarifyRow('missing', 0, 'это пластик')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects status that is not code_review_required / processed_with_errors', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED }),
      });
      await expect(service.clarifyRow('doc-1', 0, 'хлопок')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_CLARIFY },
      });
    });

    it('persists userClarification in parsedData and re-runs classifier with merged rawContext', async () => {
      const { service, repo, classifier } = createService();
      await service.clarifyRow('doc-1', 0, 'хлопок 100%');

      expect(classifier.classify).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            rawContext: expect.stringContaining('userClarification=хлопок 100%'),
          }),
        ]),
        'ru',
        0.7,
        null,
      );
      expect(repo.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          parsedData: expect.arrayContaining([
            expect.objectContaining({ userClarification: 'хлопок 100%' }),
          ]),
        }),
      );
    });

    it('rejects rowIndex out of range with UNKNOWN_ROW', async () => {
      const { service } = createService();
      await expect(service.clarifyRow('doc-1', 99, 'note')).rejects.toMatchObject({
        response: { code: ErrorCode.UNKNOWN_ROW },
      });
    });
  });
});
