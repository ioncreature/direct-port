import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/error-codes';
import { DocumentStatus } from '../database/entities/document.entity';
import { DocumentsService } from './documents.service';

interface DocOverrides {
  id?: string;
  status?: DocumentStatus;
  parsedData?: unknown[] | null;
  resultData?: unknown[] | null;
  telegramUserId?: string | null;
  uploadedByUserId?: string | null;
  companyId?: string | null;
  telegramUser?: { telegramId: string; language?: string } | null;
  rejectionReasons?: string[] | null;
  freightCost?: number | null;
  freightCurrency?: string | null;
  language?: string | null;
  errorMessage?: string | null;
}

function makeDoc(overrides: DocOverrides = {}) {
  return {
    id: 'doc-1',
    telegramUserId: 'tg-uuid-1',
    uploadedByUserId: null,
    companyId: 'comp-1',
    originalFileName: 'goods.xlsx',
    status: DocumentStatus.PENDING,
    rowCount: 1,
    parsedData: [{ description: 'foo', quantity: 1, price: 10, weight: 0.5 }],
    resultData: null as unknown[] | null,
    errorMessage: null as string | null,
    rejectionReasons: null as string[] | null,
    countryOfOrigin: null,
    countryOriginSource: null,
    countryDetectionReason: null,
    freightCost: null as number | null,
    freightCurrency: null as string | null,
    currency: 'USD',
    columnMapping: null,
    language: 'ru',
    fileBuffer: null,
    tokenUsage: null,
    telegramUser: { telegramId: '12345', language: 'ru' } as
      | { telegramId: string; language?: string }
      | null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createService(
  opts: {
    doc?: ReturnType<typeof makeDoc> | null;
    tgUser?: { language: string; companyId?: string | null } | null;
    hasBuffer?: boolean;
    country?: { code: string; nameRu: string } | null;
  } = {},
) {
  const doc = opts.doc === undefined ? makeDoc() : opts.doc;

  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ hasBuffer: opts.hasBuffer ?? false }),
  };

  const repo = {
    findOne: jest.fn().mockResolvedValue(doc),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn().mockImplementation(async (d) => d),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn().mockImplementation((d) => ({ ...d, id: 'new-doc' })),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };

  const tgUserRepo = {
    findOne: jest.fn().mockResolvedValue(opts.tgUser ?? null),
  };

  const aiUsageLogRepo = {
    manager: { query: jest.fn().mockResolvedValue([]) },
  };

  const parsingQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const processingQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const countriesService = {
    findByCode: jest.fn().mockResolvedValue(opts.country ?? null),
  };

  const audit = {
    recordDocumentVersion: jest.fn().mockResolvedValue(1),
  };

  const regulatoryInterpreter = {
    explain: jest.fn().mockResolvedValue({ byId: new Map() }),
  };

  const pipelineNotifier = {
    notify: jest.fn().mockResolvedValue(undefined),
  };

  const photoStorage = {
    deleteForDocument: jest.fn().mockResolvedValue(undefined),
  };

  const clientBalance = {
    settle: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    checkProcessingAllowed: jest.fn().mockResolvedValue({ allowed: true, need: 0, available: 0 }),
  };

  const service = new DocumentsService(
    repo as never,
    tgUserRepo as never,
    aiUsageLogRepo as never,
    parsingQueue as never,
    processingQueue as never,
    countriesService as never,
    audit as never,
    regulatoryInterpreter as never,
    pipelineNotifier as never,
    photoStorage as never,
    clientBalance as never,
  );

  return {
    service,
    repo,
    tgUserRepo,
    parsingQueue,
    processingQueue,
    countriesService,
    audit,
    pipelineNotifier,
    photoStorage,
    clientBalance,
    queryBuilder,
  };
}

describe('DocumentsService', () => {
  describe('createFromFile', () => {
    it('saves the file buffer, sets PARSING status, queues parse-document', async () => {
      const { service, repo, parsingQueue } = createService({ doc: null });
      const result = await service.createFromFile(
        Buffer.from('xlsx-bytes'),
        'goods.xlsx',
        { telegramUserId: 'tg-uuid-1' },
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramUserId: 'tg-uuid-1',
          fileBuffer: expect.any(Buffer),
          status: DocumentStatus.PARSING,
        }),
      );
      expect(parsingQueue.add).toHaveBeenCalledWith(
        'parse-document',
        { documentId: 'new-doc' },
        expect.objectContaining({ attempts: 3 }),
      );
      // fileBuffer is stripped from the returned payload (otherwise Express
      // would ship it back in the JSON response).
      expect((result as { fileBuffer?: Buffer }).fileBuffer).toBeUndefined();
    });

    it('reads language from TelegramUser when uploaded via bot', async () => {
      const { service, repo, tgUserRepo } = createService({
        doc: null,
        tgUser: { language: 'zh' },
      });
      await service.createFromFile(Buffer.from('x'), 'f.xlsx', {
        telegramUserId: 'tg-uuid-1',
      });
      expect(tgUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'tg-uuid-1' },
        select: ['language', 'companyId'],
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh' }),
      );
    });

    it('stores uploadedByUserId + company for admin uploads (no telegram lookup)', async () => {
      const { service, repo, tgUserRepo } = createService({ doc: null });
      await service.createFromFile(Buffer.from('x'), 'f.xlsx', {
        uploadedByUserId: 'admin-uuid',
        companyId: 'comp-1',
      });
      expect(tgUserRepo.findOne).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramUserId: null,
          uploadedByUserId: 'admin-uuid',
          companyId: 'comp-1',
          language: null,
        }),
      );
    });

    it('rejects freight cost without currency as 400 INVALID_FREIGHT', async () => {
      const { service } = createService({ doc: null });
      await expect(
        service.createFromFile(Buffer.from('x'), 'f.xlsx', { telegramUserId: 't' }, {
          freightCost: 100,
          // freightCurrency intentionally omitted — should fail
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_FREIGHT },
      });
    });

    it('treats non-positive freight cost as a reset (no error, both fields null)', async () => {
      const { service, repo } = createService({ doc: null });
      await service.createFromFile(
        Buffer.from('x'),
        'f.xlsx',
        { telegramUserId: 't' },
        { freightCost: 0, freightCurrency: 'USD' },
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ freightCost: null, freightCurrency: null }),
      );
    });
  });

  describe('recalculate', () => {
    it('rejects when document has no resultData (use reprocess instead)', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED, resultData: null }),
      });
      await expect(service.recalculate('doc-1', {})).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
    });

    it('rejects REJECTED document — recalculate must not resurrect it to PROCESSED', async () => {
      const { service, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.REJECTED, resultData: [{}] }),
      });
      await expect(service.recalculate('doc-1', {})).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('rejects PENDING/PROCESSING documents (race with an active pipeline run)', async () => {
      for (const status of [DocumentStatus.PENDING, DocumentStatus.PROCESSING]) {
        const { service } = createService({
          doc: makeDoc({ status, resultData: [{}] }),
        });
        await expect(service.recalculate('doc-1', {})).rejects.toMatchObject({
          response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
        });
      }
    });

    it('allows recalculate for FAILED document with resultData (recovery path)', async () => {
      const { service, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.FAILED, resultData: [{}] }),
      });
      await service.recalculate('doc-1', {});
      expect(processingQueue.add).toHaveBeenCalledWith('recalculate-document', {
        documentId: 'doc-1',
      });
    });

    it('rejects unknown country code with 400 UNKNOWN_COUNTRY', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED, resultData: [{}] }),
        country: null,
      });
      await expect(
        service.recalculate('doc-1', { countryOfOrigin: '999' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.UNKNOWN_COUNTRY },
      });
    });

    it('applies country, resets status to PENDING (атомарно), queues recalculate-document', async () => {
      const { service, repo, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED, resultData: [{}] }),
        country: { code: '156', nameRu: 'Китай' },
      });
      const result = await service.recalculate('doc-1', { countryOfOrigin: '156' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'doc-1', status: DocumentStatus.PROCESSED },
        expect.objectContaining({
          status: DocumentStatus.PENDING,
          countryOfOrigin: '156',
          countryOriginSource: 'manual',
        }),
      );
      expect(processingQueue.add).toHaveBeenCalledWith('recalculate-document', {
        documentId: 'doc-1',
      });
      expect(result.status).toBe(DocumentStatus.PENDING);
    });

    it('passes freight overrides through normalizeFreightInput', async () => {
      const { service, repo } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED, resultData: [{}] }),
      });
      await service.recalculate('doc-1', { freightCost: 100, freightCurrency: 'USD' });
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ freightCost: 100, freightCurrency: 'USD' }),
      );
    });

    it('двойной клик «Пересчитать» (конкурентная смена статуса): 400, job не ставится', async () => {
      const { service, repo, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED, resultData: [{}] }),
      });
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.recalculate('doc-1', {})).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
      expect(processingQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('reprocess', () => {
    it('rejects status that is not failed/requires_review/processed_with_errors', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED }),
      });
      await expect(service.reprocess('doc-1')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
    });

    it('routes to parsing queue when parsedData is empty but fileBuffer is present', async () => {
      const { service, parsingQueue, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.FAILED, parsedData: [] }),
        hasBuffer: true,
      });
      await service.reprocess('doc-1');
      expect(parsingQueue.add).toHaveBeenCalledWith(
        'parse-document',
        { documentId: 'doc-1' },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('routes to processing queue when parsedData is present', async () => {
      const { service, parsingQueue, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.REQUIRES_REVIEW }),
      });
      await service.reprocess('doc-1');
      expect(processingQueue.add).toHaveBeenCalledWith('process-document', {
        documentId: 'doc-1',
      });
      expect(parsingQueue.add).not.toHaveBeenCalled();
    });

    it('переход статуса атомарный (UPDATE WHERE прежний статус) + чистит ошибку и resultData', async () => {
      const { service, repo } = createService({
        doc: makeDoc({
          status: DocumentStatus.FAILED,
          errorMessage: 'old error',
          resultData: [{ stale: true }],
        }),
      });
      await service.reprocess('doc-1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'doc-1', status: DocumentStatus.FAILED },
        { status: DocumentStatus.PENDING, errorMessage: null, resultData: null },
      );
    });

    it('двойной клик (конкурентная смена статуса): второй запрос получает 400, job не ставится', async () => {
      const { service, repo, parsingQueue, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.FAILED }),
      });
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.reprocess('doc-1')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
      expect(parsingQueue.add).not.toHaveBeenCalled();
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('нет ни parsedData, ни буфера → 400 «нечего переобрабатывать» (раньше выходил PROCESSED с 0 строк)', async () => {
      const { service, parsingQueue, processingQueue } = createService({
        doc: makeDoc({ status: DocumentStatus.FAILED, parsedData: null }),
        hasBuffer: false,
      });
      await expect(service.reprocess('doc-1')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REPROCESS },
      });
      expect(parsingQueue.add).not.toHaveBeenCalled();
      expect(processingQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('updateParsedData', () => {
    it('rejects when document is not in REQUIRES_REVIEW status', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED }),
      });
      await expect(
        service.updateParsedData('doc-1', { parsedData: [], currency: 'USD' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REVIEW },
      });
    });

    it('saves new parsedData and records a manual_edit document version', async () => {
      const { service, repo, audit } = createService({
        doc: makeDoc({ status: DocumentStatus.REQUIRES_REVIEW }),
      });
      const newRows = [
        { description: 'a', quantity: 2, price: 100, weight: 1 },
        { description: 'b', quantity: 1, price: 50, weight: 0.5 },
      ];
      await service.updateParsedData(
        'doc-1',
        { parsedData: newRows as never, currency: 'EUR' },
        { userId: 'editor-uuid' },
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ parsedData: newRows, rowCount: 2, currency: 'EUR' }),
      );
      expect(audit.recordDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          reason: 'manual_edit',
          actorType: 'user',
          actorId: 'editor-uuid',
        }),
      );
    });
  });

  describe('reject', () => {
    it('rejects status that is not requires_review / code_review_required', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.PROCESSED }),
      });
      await expect(service.reject('doc-1', { reason: 'nope' })).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_REJECT },
      });
    });

    it('REQUIRES_REVIEW → FAILED with operator comment as errorMessage', async () => {
      const { service, repo, pipelineNotifier } = createService({
        doc: makeDoc({ status: DocumentStatus.REQUIRES_REVIEW }),
      });
      await service.reject('doc-1', { reason: 'data is garbage' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentStatus.FAILED,
          errorMessage: 'data is garbage',
        }),
      );
      expect(pipelineNotifier.notify).toHaveBeenCalled();
    });

    it('CODE_REVIEW_REQUIRED → REJECTED and merges operator comment into rejectionReasons', async () => {
      const { service, repo, pipelineNotifier } = createService({
        doc: makeDoc({
          status: DocumentStatus.CODE_REVIEW_REQUIRED,
          rejectionReasons: ['Auto: too many low-confidence codes'],
        }),
      });
      await service.reject('doc-1', { reason: 'looks wrong' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentStatus.REJECTED,
          rejectionReasons: [
            'Комментарий оператора: looks wrong',
            'Auto: too many low-confidence codes',
          ],
        }),
      );
      expect(pipelineNotifier.notify).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('rejects status that is not CODE_REVIEW_REQUIRED', async () => {
      const { service } = createService({
        doc: makeDoc({ status: DocumentStatus.REQUIRES_REVIEW }),
      });
      await expect(service.approve('doc-1')).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_STATUS_FOR_APPROVE },
      });
    });

    it('CODE_REVIEW_REQUIRED → PROCESSED, clears rejectionReasons, notifies', async () => {
      const { service, repo, pipelineNotifier } = createService({
        doc: makeDoc({
          status: DocumentStatus.CODE_REVIEW_REQUIRED,
          rejectionReasons: ['Stale auto reason'],
        }),
      });
      await service.approve('doc-1');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentStatus.PROCESSED,
          rejectionReasons: null,
        }),
      );
      expect(pipelineNotifier.notify).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException with DOCUMENT_NOT_FOUND code when missing', async () => {
      const { service } = createService({ doc: null });
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('missing')).rejects.toMatchObject({
        response: { code: ErrorCode.DOCUMENT_NOT_FOUND },
      });
    });
  });

  describe('getChecklist', () => {
    it('строит чек-лист из resultData: базовый пакет + меры строк', async () => {
      const doc = makeDoc({
        status: DocumentStatus.PROCESSED,
        resultData: [
          {
            tnVedCode: '6403911100',
            regulatoryReport: {
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
            },
          },
        ],
      });
      const { service } = createService({ doc });
      const checklist = await service.getChecklist('doc-1');

      expect(checklist.documentId).toBe('doc-1');
      expect(checklist.status).toBe(DocumentStatus.PROCESSED);
      expect(checklist.items.some((i) => i.title.includes('Внешнеторговый контракт'))).toBe(true);
      // Код обуви ловит curated-волну маркировки даже при молчании TKS.
      expect(checklist.items.some((i) => i.title.includes('Честный знак'))).toBe(true);
      expect(Array.isArray(checklist.warnings)).toBe(true);
    });

    it('документ без resultData → 400 CHECKLIST_NOT_AVAILABLE', async () => {
      const doc = makeDoc({ resultData: null });
      const { service } = createService({ doc });
      await expect(service.getChecklist('doc-1')).rejects.toMatchObject({
        response: { code: ErrorCode.CHECKLIST_NOT_AVAILABLE },
      });
    });

    it('несуществующий документ → 404', async () => {
      const { service } = createService({ doc: null });
      await expect(service.getChecklist('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatusCounts', () => {
    it('returns a status → count map from a groupBy query', async () => {
      const { service, queryBuilder } = createService();
      queryBuilder.getRawMany.mockResolvedValueOnce([
        { status: DocumentStatus.PROCESSED, count: '12' },
        { status: DocumentStatus.FAILED, count: '3' },
      ]);
      const counts = await service.getStatusCounts();
      expect(counts).toEqual({
        [DocumentStatus.PROCESSED]: 12,
        [DocumentStatus.FAILED]: 3,
      });
    });
  });

});
