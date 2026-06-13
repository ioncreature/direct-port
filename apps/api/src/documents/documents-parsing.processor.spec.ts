import type { Job } from 'bullmq';
import type { AiParseResult } from '../ai-parser/ai-parser.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DocumentsParsingProcessor } from './documents-parsing.processor';
import { PipelineNotifierService } from './pipeline-notifier.service';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    originalFileName: 'test.csv',
    status: DocumentStatus.PARSING,
    fileBuffer: Buffer.from('description,price,weight,quantity\nTest,100,1,5'),
    currency: null,
    columnMapping: null,
    language: null,
    countryOfOrigin: null,
    countryOriginSource: null,
    countryDetectionReason: null,
    rowCount: 0,
    parsedData: null,
    resultData: null,
    tokenUsage: null,
    errorMessage: null,
    rejectionReasons: null,
    telegramUser: null,
    uploadedBy: null,
    createdAt: new Date('2026-04-20T10:00:00Z'),
    updatedAt: new Date('2026-04-20T10:00:00Z'),
    ...overrides,
  });
  return doc;
}

function makeParseResult(overrides: Partial<AiParseResult> = {}): AiParseResult {
  return {
    products: [{ description: 'Test', quantity: 5, price: 100, weight: 1 }],
    currency: 'USD',
    columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
    feasibility: 'ok',
    rejectionReasons: [],
    rejectionReasonsData: [],
    countrySuggestion: null,
    tokenUsage: {},
    ...overrides,
  };
}

interface Opts {
  doc?: Document | null;
  parseResult?: AiParseResult;
  parseError?: Error;
}

function createProcessor(opts: Opts = {}) {
  const doc = opts.doc === null ? null : opts.doc ?? makeDoc();

  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(doc),
  };

  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    save: jest.fn().mockImplementation((d: Document) => Promise.resolve(d)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const processingQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const aiParser = {
    parse: jest.fn().mockImplementation(() => {
      if (opts.parseError) return Promise.reject(opts.parseError);
      return Promise.resolve(opts.parseResult ?? makeParseResult());
    }),
  };

  const audit = {
    startStageRun: jest.fn().mockResolvedValue('stage-run-id'),
    completeStageRun: jest.fn().mockResolvedValue(undefined),
    failStageRun: jest.fn().mockResolvedValue(undefined),
    recordAiCall: jest.fn().mockResolvedValue(undefined),
    recordDocumentVersion: jest.fn().mockResolvedValue(1),
  };

  const photoStorage = {
    savePhotos: jest.fn().mockResolvedValue([]),
    deleteForDocument: jest.fn().mockResolvedValue(undefined),
    getByHash: jest.fn().mockResolvedValue([]),
  };

  const managerNotify = {
    notifyDocumentEvent: jest.fn().mockResolvedValue(undefined),
  };

  // Реальный нотификатор поверх мок-менеджера: managed → notifyDocumentEvent,
  // self_service → no-op (после удаления tg-bot self_service-уведомлений нет).
  const pipelineNotifier = new PipelineNotifierService(managerNotify as any);

  const processor = new DocumentsParsingProcessor(
    repo as any,
    processingQueue as any,
    aiParser as any,
    audit as any,
    photoStorage as any,
    pipelineNotifier as any,
  );

  return {
    processor,
    doc,
    repo,
    processingQueue,
    aiParser,
    audit,
    managerNotify,
  };
}

function fakeJob(
  documentId: string,
  jobOpts: { attempts?: number; attemptsMade?: number } = {},
): Job<{ documentId: string }> {
  return {
    name: 'parse-document',
    data: { documentId },
    attemptsMade: jobOpts.attemptsMade ?? 0,
    opts: jobOpts.attempts ? { attempts: jobOpts.attempts } : {},
    id: 'job-1',
  } as any;
}

describe('DocumentsParsingProcessor.process', () => {
  describe('basic flow', () => {
    it('document not found → warn, save не зовётся', async () => {
      const { processor, repo } = createProcessor({ doc: null });

      await processor.process(fakeJob('missing'));

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('feasibility=ok → сохраняет parsedData, status=PENDING, отправляет в processing queue', async () => {
      const doc = makeDoc();
      const { processor, processingQueue } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.PENDING);
      expect(doc.parsedData).toHaveLength(1);
      expect(doc.currency).toBe('USD');
      expect(doc.rowCount).toBe(1);
      expect(processingQueue.add).toHaveBeenCalledWith('process-document', {
        documentId: 'doc-1',
      });
    });

    it('feasibility=review → status=REQUIRES_REVIEW, rejectionReasons, processing НЕ вызывается', async () => {
      const doc = makeDoc();
      const { processor, processingQueue } = createProcessor({
        doc,
        parseResult: makeParseResult({
          feasibility: 'review',
          rejectionReasons: ['Низкая уверенность в валюте'],
        }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.REQUIRES_REVIEW);
      expect(doc.rejectionReasons).toEqual(['Низкая уверенность в валюте']);
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('feasibility=review с пустым массивом rejectionReasons → null в БД', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        parseResult: makeParseResult({ feasibility: 'review', rejectionReasons: [] }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.rejectionReasons).toBeNull();
    });

    it('feasibility=rejected → status=REJECTED, processing НЕ вызывается', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const reasons = ['Файл не содержит таблицу товаров'];
      const { processor, processingQueue } = createProcessor({
        doc,
        parseResult: makeParseResult({
          feasibility: 'rejected',
          rejectionReasons: reasons,
        }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.REJECTED);
      expect(doc.rejectionReasons).toEqual(reasons);
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it('managed-документ rejected → уведомляем менеджера', async () => {
      const doc = makeDoc({ source: 'managed', telegramUser: { telegramId: '123' } as any });
      const { processor, managerNotify } = createProcessor({
        doc,
        parseResult: makeParseResult({ feasibility: 'rejected', rejectionReasons: ['x'] }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.REJECTED);
      expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
    });
  });

  describe('fileBuffer handling', () => {
    it('без fileBuffer → FAILED, парсер не вызывается', async () => {
      const doc = makeDoc({
        fileBuffer: null,
        telegramUser: { telegramId: '123' } as any,
      });
      const { processor, aiParser } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('File buffer is missing');
      expect(aiParser.parse).not.toHaveBeenCalled();
    });

    it('fileBuffer очищается после успешного парсинга', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.fileBuffer).toBeNull();
    });

    it('fileBuffer СОХРАНЯЕТСЯ при ошибке парсинга — иначе reprocess не сможет перепарсить', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor, repo } = createProcessor({
        doc,
        parseError: new Error('AI timeout'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.fileBuffer).not.toBeNull();
      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('AI timeout');
      // FAILED пишется точечным update (не save), чтобы не гонять буфер и не затирать его.
      expect(repo.update).toHaveBeenCalledWith('doc-1', {
        status: DocumentStatus.FAILED,
        errorMessage: 'AI timeout',
      });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('ретраи и guard статуса', () => {
    it('не последняя попытка: бросает для BullMQ-ретрая, статус НЕ трогает', async () => {
      const doc = makeDoc();
      const { processor, repo } = createProcessor({
        doc,
        parseError: new Error('529 overloaded'),
      });

      await expect(
        processor.process(fakeJob('doc-1', { attempts: 3, attemptsMade: 0 })),
      ).rejects.toThrow('529 overloaded');

      expect(doc.status).toBe(DocumentStatus.PARSING);
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('последняя попытка: FAILED', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor } = createProcessor({
        doc,
        parseError: new Error('529 overloaded'),
      });

      await processor.process(fakeJob('doc-1', { attempts: 3, attemptsMade: 2 }));

      expect(doc.status).toBe(DocumentStatus.FAILED);
    });

    it('документ уже не в PARSING (stalled-повтор после успеха): выходит, не трогая ничего', async () => {
      const doc = makeDoc({ status: DocumentStatus.PENDING, fileBuffer: null });
      const { processor, repo, aiParser, managerNotify } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(aiParser.parse).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
      expect(doc.status).toBe(DocumentStatus.PENDING);
    });
  });

  describe('country suggestion', () => {
    it('применяет countrySuggestion когда source не "manual"', async () => {
      const doc = makeDoc({ countryOriginSource: null });
      const { processor } = createProcessor({
        doc,
        parseResult: makeParseResult({
          countrySuggestion: {
            code: '156',
            source: 'ai_language',
            reason: 'Описания на китайском',
          },
        }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.countryOfOrigin).toBe('156');
      expect(doc.countryOriginSource).toBe('ai_language');
      expect(doc.countryDetectionReason).toBe('Описания на китайском');
    });

    it('НЕ затирает countryOrigin если countryOriginSource=manual (reparse)', async () => {
      const doc = makeDoc({
        countryOfOrigin: '840',
        countryOriginSource: 'manual',
        countryDetectionReason: 'Указано оператором',
      });
      const { processor } = createProcessor({
        doc,
        parseResult: makeParseResult({
          countrySuggestion: {
            code: '156',
            source: 'ai_language',
            reason: 'AI переопределить',
          },
        }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.countryOfOrigin).toBe('840');
      expect(doc.countryOriginSource).toBe('manual');
      expect(doc.countryDetectionReason).toBe('Указано оператором');
    });

    it('countrySuggestion=null → не трогает countryOfOrigin', async () => {
      const doc = makeDoc({ countryOfOrigin: null });
      const { processor } = createProcessor({
        doc,
        parseResult: makeParseResult({ countrySuggestion: null }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.countryOfOrigin).toBeNull();
      expect(doc.countryOriginSource).toBeNull();
    });
  });

  describe('tokenUsage', () => {
    it('аккумулирует usage под ключом "parser"', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        parseResult: makeParseResult({
          tokenUsage: {
            'claude-sonnet': {
              inputTokens: 500,
              outputTokens: 200,
            },
          },
        }),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.tokenUsage).toBeDefined();
      expect(doc.tokenUsage!.parser).toEqual(
        expect.objectContaining({
          'claude-sonnet': expect.objectContaining({ inputTokens: 500, outputTokens: 200 }),
        }),
      );
    });
  });

  describe('обработка ошибок', () => {
    it('aiParser бросает rate-limit → FAILED + errorMessage', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor } = createProcessor({
        doc,
        parseError: new Error('Claude rate limit'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Claude rate limit');
    });

    it('aiParser бросает generic ошибку → FAILED', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor } = createProcessor({
        doc,
        parseError: new Error('something unexpected went wrong'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
    });

    it('self_service ошибка парсинга → менеджеру не уведомляем', async () => {
      const doc = makeDoc({ source: 'self_service', telegramUser: null });
      const { processor, managerNotify } = createProcessor({
        doc,
        parseError: new Error('fail'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
    });

    it('Error с пустым message → errorMessage="Parsing failed"', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({
        doc,
        parseError: new Error(''),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.errorMessage).toBe('Parsing failed');
    });
  });
});
