import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import {
  createTestApp,
  seedAdmin,
  seedTelegramUser,
  seedCalculationConfig,
  loginAsAdmin,
  INTERNAL_KEY_HEADER,
} from './helpers';
import { Document, DocumentStatus } from '../src/database/entities/document.entity';
import { AiParserService } from '../src/ai-parser/ai-parser.service';
import { DocumentsParsingProcessor } from '../src/documents/documents-parsing.processor';

describe('Document parsing (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let telegramUserId: string;
  let repo: Repository<Document>;
  let aiParser: AiParserService;
  let processor: DocumentsParsingProcessor;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    const tgUser = await seedTelegramUser(app);
    telegramUserId = tgUser.id;
    await seedCalculationConfig(app);
    const auth = await loginAsAdmin(app);
    adminToken = auth.accessToken;

    const ds = app.get(DataSource);
    repo = ds.getRepository(Document);
    aiParser = app.get(AiParserService);
    processor = app.get(DocumentsParsingProcessor);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    (aiParser.parse as jest.Mock).mockClear();
  });

  const csvContent = 'description,price,weight,quantity\nTest product,100,10,5';

  // --- Upload endpoints ---

  describe('POST /api/documents/upload', () => {
    it('should return immediately with parsing status', async () => {
      const start = Date.now();

      const res = await request(app.getHttpServer())
        .post('/api/documents/upload')
        .set(INTERNAL_KEY_HEADER)
        .attach('file', Buffer.from(csvContent), 'test.csv')
        .field('telegramUserId', telegramUserId)
        .expect(201);

      const elapsed = Date.now() - start;

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('parsing');
      expect(res.body.originalFileName).toBe('test.csv');
      // Should respond in under 5 seconds (was 60-90s before)
      expect(elapsed).toBeLessThan(5000);
      // fileBuffer should not be leaked in response
      expect(res.body.fileBuffer).toBeUndefined();
    });

    it('should save fileBuffer in DB', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/documents/upload')
        .set(INTERNAL_KEY_HEADER)
        .attach('file', Buffer.from(csvContent), 'buffer-test.csv')
        .field('telegramUserId', telegramUserId)
        .expect(201);

      const doc = await repo
        .createQueryBuilder('doc')
        .addSelect('doc.fileBuffer')
        .where('doc.id = :id', { id: res.body.id })
        .getOne();

      expect(doc).toBeDefined();
      expect(doc!.fileBuffer).toBeDefined();
      expect(Buffer.isBuffer(doc!.fileBuffer)).toBe(true);
      expect(doc!.fileBuffer!.toString()).toContain('Test product');
    });

    it('should reject without file', async () => {
      await request(app.getHttpServer())
        .post('/api/documents/upload')
        .set(INTERNAL_KEY_HEADER)
        .field('telegramUserId', telegramUserId)
        .expect(400);
    });
  });

  describe('POST /api/documents/upload-admin', () => {
    it('should return immediately with parsing status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/documents/upload-admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csvContent), 'admin-test.csv')
        .expect(201);

      expect(res.body.status).toBe('parsing');
    });
  });

  // --- Parsing processor ---

  describe('DocumentsParsingProcessor', () => {
    function createFakeJob(documentId: string) {
      return { data: { documentId } } as any;
    }

    async function createDocumentWithBuffer(overrides: Partial<Document> = {}): Promise<Document> {
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'processor-test.csv',
        status: DocumentStatus.PARSING,
        fileBuffer: Buffer.from(csvContent),
        ...overrides,
      });
      return repo.save(doc);
    }

    it('should parse document and transition to PENDING when confident', async () => {
      const doc = await createDocumentWithBuffer();

      await processor.process(createFakeJob(doc.id));

      const updated = await repo.findOne({ where: { id: doc.id } });
      expect(updated!.status).toBe(DocumentStatus.PENDING);
      expect(updated!.parsedData).toHaveLength(2);
      expect(updated!.currency).toBe('USD');
      expect(updated!.columnMapping).toBeDefined();
      expect(updated!.rowCount).toBe(2);
    });

    it('should transition to REQUIRES_REVIEW when not confident', async () => {
      (aiParser.parse as jest.Mock).mockResolvedValueOnce({
        products: [{ description: 'Неуверенный товар', quantity: 1, price: 10, weight: 1 }],
        currency: 'CNY',
        columnMapping: { description: 0 },
        confident: false,
      });

      const doc = await createDocumentWithBuffer();

      await processor.process(createFakeJob(doc.id));

      const updated = await repo.findOne({ where: { id: doc.id } });
      expect(updated!.status).toBe(DocumentStatus.REQUIRES_REVIEW);
      expect(updated!.parsedData).toHaveLength(1);
    });

    it('should transition to FAILED on parse error', async () => {
      (aiParser.parse as jest.Mock).mockRejectedValueOnce(
        new Error('AI service unavailable'),
      );

      const doc = await createDocumentWithBuffer();

      await processor.process(createFakeJob(doc.id));

      const updated = await repo.findOne({ where: { id: doc.id } });
      expect(updated!.status).toBe(DocumentStatus.FAILED);
      expect(updated!.errorMessage).toBe('AI service unavailable');
    });

    it('should clear fileBuffer after successful parsing', async () => {
      const doc = await createDocumentWithBuffer();

      await processor.process(createFakeJob(doc.id));

      const updated = await repo
        .createQueryBuilder('doc')
        .addSelect('doc.fileBuffer')
        .where('doc.id = :id', { id: doc.id })
        .getOne();

      expect(updated!.fileBuffer).toBeNull();
    });

    it('should clear fileBuffer after failed parsing', async () => {
      (aiParser.parse as jest.Mock).mockRejectedValueOnce(new Error('fail'));

      const doc = await createDocumentWithBuffer();

      await processor.process(createFakeJob(doc.id));

      const updated = await repo
        .createQueryBuilder('doc')
        .addSelect('doc.fileBuffer')
        .where('doc.id = :id', { id: doc.id })
        .getOne();

      expect(updated!.fileBuffer).toBeNull();
    });

    it('should handle missing document gracefully', async () => {
      // Should not throw
      await processor.process(
        createFakeJob('00000000-0000-0000-0000-000000000000'),
      );
    });

    it('should fail when fileBuffer is missing', async () => {
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'no-buffer.csv',
        status: DocumentStatus.PARSING,
      });
      const saved = await repo.save(doc);

      await processor.process(createFakeJob(saved.id));

      const updated = await repo.findOne({ where: { id: saved.id } });
      expect(updated!.status).toBe(DocumentStatus.FAILED);
      expect(updated!.errorMessage).toContain('File buffer is missing');
    });
  });

  // --- Reprocess ---

  describe('POST /api/documents/:id/reprocess', () => {
    it('should re-process document that has parsedData', async () => {
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'reprocess-with-data.csv',
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
        parsedData: [{ description: 'Товар', quantity: 1, price: 100, weight: 10 }],
        rowCount: 1,
        status: DocumentStatus.FAILED,
        errorMessage: 'Previous error',
      });
      const saved = await repo.save(doc);

      const res = await request(app.getHttpServer())
        .post(`/api/documents/${saved.id}/reprocess`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      // Has parsedData → goes to document-processing (PENDING)
      expect(res.body.status).toBe('pending');
      expect(res.body.errorMessage).toBeNull();
    });

    it('should re-parse document that has fileBuffer but no parsedData', async () => {
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'reprocess-reparse.csv',
        status: DocumentStatus.FAILED,
        fileBuffer: Buffer.from(csvContent),
        errorMessage: 'Parse failed',
      });
      const saved = await repo.save(doc);

      const res = await request(app.getHttpServer())
        .post(`/api/documents/${saved.id}/reprocess`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      // No parsedData + has fileBuffer → goes to document-parsing (PARSING)
      expect(res.body.status).toBe('parsing');
      expect(res.body.errorMessage).toBeNull();
    });

    it('should reject reprocess for non-failed documents', async () => {
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'reprocess-pending.csv',
        columnMapping: {},
        parsedData: [],
        rowCount: 0,
        status: DocumentStatus.PENDING,
      });
      const saved = await repo.save(doc);

      await request(app.getHttpServer())
        .post(`/api/documents/${saved.id}/reprocess`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  // --- Filtering by parsing status ---

  describe('GET /api/documents?status=parsing', () => {
    it('should filter documents by parsing status', async () => {
      // Create a document with parsing status
      const doc = repo.create({
        telegramUserId,
        originalFileName: 'filter-parsing.csv',
        status: DocumentStatus.PARSING,
      });
      await repo.save(doc);

      const res = await request(app.getHttpServer())
        .get('/api/documents?status=parsing')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((d: any) => {
        expect(d.status).toBe('parsing');
      });
    });
  });
});
