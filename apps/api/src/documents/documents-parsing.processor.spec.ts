import type { Job } from 'bullmq';
import type { AiParseResult } from '../ai-parser/ai-parser.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DocumentsParsingProcessor } from './documents-parsing.processor';

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
  };

  const processingQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };

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

  const processor = new DocumentsParsingProcessor(
    repo as any,
    processingQueue as any,
    notificationQueue as any,
    aiParser as any,
    audit as any,
    photoStorage as any,
  );

  return { processor, doc, repo, processingQueue, notificationQueue, aiParser, audit };
}

function fakeJob(documentId: string): Job<{ documentId: string }> {
  return { name: 'parse-document', data: { documentId }, attemptsMade: 0, id: 'job-1' } as any;
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

    it('feasibility=ok → отправляет промежуточный stage_classifying', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor, notificationQueue } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({ status: 'stage_classifying', itemCount: 1 }),
      );
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

    it('feasibility=rejected → status=REJECTED + notify с rejectionReasons', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const reasons = ['Файл не содержит таблицу товаров'];
      const { processor, notificationQueue, processingQueue } = createProcessor({
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
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({ status: 'rejected', rejectionReasons: reasons }),
      );
    });
  });

  describe('fileBuffer handling', () => {
    it('без fileBuffer → FAILED + notify (если есть telegramUser)', async () => {
      const doc = makeDoc({
        fileBuffer: null,
        telegramUser: { telegramId: '123' } as any,
      });
      const { processor, notificationQueue, aiParser } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('File buffer is missing');
      expect(aiParser.parse).not.toHaveBeenCalled();
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('fileBuffer очищается после успешного парсинга', async () => {
      const doc = makeDoc();
      const { processor } = createProcessor({ doc });

      await processor.process(fakeJob('doc-1'));

      expect(doc.fileBuffer).toBeNull();
    });

    it('fileBuffer очищается даже при ошибке парсинга', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor } = createProcessor({
        doc,
        parseError: new Error('AI timeout'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.fileBuffer).toBeNull();
      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('AI timeout');
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
    it('aiParser бросает rate-limit → FAILED + errorCode=AI_UNAVAILABLE', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor, notificationQueue } = createProcessor({
        doc,
        parseError: new Error('Claude rate limit'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(doc.errorMessage).toBe('Claude rate limit');
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({
          status: 'failed',
          errorCode: 'AI_UNAVAILABLE',
        }),
      );
    });

    it('aiParser бросает generic ошибку → FAILED + errorCode=PARSING_FAILED', async () => {
      const doc = makeDoc({ telegramUser: { telegramId: '123' } as any });
      const { processor, notificationQueue } = createProcessor({
        doc,
        parseError: new Error('something unexpected went wrong'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({
          status: 'failed',
          errorCode: 'PARSING_FAILED',
        }),
      );
    });

    it('без telegramUser — notify пропускается при ошибке парсинга', async () => {
      const doc = makeDoc({ telegramUser: null });
      const { processor, notificationQueue } = createProcessor({
        doc,
        parseError: new Error('fail'),
      });

      await processor.process(fakeJob('doc-1'));

      expect(doc.status).toBe(DocumentStatus.FAILED);
      expect(notificationQueue.add).not.toHaveBeenCalled();
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
