import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { CalculatorService } from '../src/calculator/calculator.service';
import { ClassifierService } from '../src/classifier/classifier.service';
import { Document, DocumentStatus } from '../src/database/entities/document.entity';
import { ExcelExportService } from '../src/documents/excel-export.service';
import {
  createTestApp,
  INTERNAL_KEY_HEADER,
  loginAsAdmin,
  seedAdmin,
  seedCalculationConfig,
  seedTelegramUser,
} from './helpers';

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let telegramUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    const tgUser = await seedTelegramUser(app);
    telegramUserId = tgUser.id;
    await seedCalculationConfig(app);
    const auth = await loginAsAdmin(app);
    adminToken = auth.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const sampleParsedData = [
    { description: 'Говядина замороженная', quantity: 10, price: 500, weight: 100 },
    { description: 'Кофе арабика', quantity: 5, price: 200, weight: 25 },
  ];

  describe('POST /api/documents', () => {
    it('should create a document via internal key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/documents')
        .set(INTERNAL_KEY_HEADER)
        .send({
          telegramUserId,
          originalFileName: 'test.xlsx',
          columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
          parsedData: sampleParsedData,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('pending');
      expect(res.body.rowCount).toBe(2);
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/documents')
        .send({
          telegramUserId,
          originalFileName: 'test.xlsx',
          columnMapping: {},
          parsedData: [],
        })
        .expect(401);
    });

    it('should validate required fields', async () => {
      await request(app.getHttpServer())
        .post('/api/documents')
        .set(INTERNAL_KEY_HEADER)
        .send({ originalFileName: 'test.xlsx' })
        .expect(400);
    });
  });

  describe('GET /api/documents', () => {
    it('should list documents for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('limit', 20);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('originalFileName');
      expect(res.body.data[0]).toHaveProperty('status');
      // findAll не возвращает тяжёлые поля
      expect(res.body.data[0]).not.toHaveProperty('parsedData');
    });

    it('should reject for unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/documents').expect(401);
    });

    it('should reject for internal key (no role)', async () => {
      await request(app.getHttpServer()).get('/api/documents').set(INTERNAL_KEY_HEADER).expect(403);
    });
  });

  describe('GET /api/documents/:id', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/documents')
        .set(INTERNAL_KEY_HEADER)
        .send({
          telegramUserId,
          originalFileName: 'detail-test.xlsx',
          columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
          parsedData: sampleParsedData,
        });
      docId = res.body.id;
    });

    it('should return document details for admin', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(docId);
      expect(res.body.parsedData).toHaveLength(2);
      expect(res.body.telegramUser).toBeDefined();
    });

    it('should return 404 for non-existent id', async () => {
      await request(app.getHttpServer())
        .get('/api/documents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Document processing pipeline', () => {
    it('should classify and calculate correctly', async () => {
      const classifier = app.get(ClassifierService);
      const calculator = app.get(CalculatorService);

      const { products } = await classifier.classify([
        { description: 'Говядина', quantity: 10, price: 500, weight: 100 },
      ]);

      expect(products).toHaveLength(1);
      expect(products[0].matched).toBe(true);
      expect(products[0].tnVedCode).toBe('0201100001');
      expect(products[0].dutyRate).toBe(15);
      expect(products[0].vatRate).toBe(20);

      const summary = calculator.calculate(products, {
        pricePercent: 5,
        weightRate: 2,
        fixedFee: 10,
      });

      expect(summary.items).toHaveLength(1);
      const item = summary.items[0];
      // totalPrice = 500 * 10 = 5000
      expect(item.totalPrice).toBe(5000);
      // dutyAmount = 5000 * 15% = 750
      expect(item.dutyAmount).toBe(750);
      // exciseAmount = 0
      expect(item.exciseAmount).toBe(0);
      // vatAmount = (5000 + 750 + 0) * 20% = 1150
      expect(item.vatAmount).toBe(1150);
      // logisticsCommission = 5000 * 5% + 100 * 10 * 2 + 10 = 250 + 2000 + 10 = 2260
      expect(item.logisticsCommission).toBe(2260);
      // totalCost = 5000 + 750 + 1150 + 0 + 2260 = 9160
      expect(item.totalCost).toBe(9160);
      expect(summary.grandTotal).toBe(9160);
    });
  });

  describe('GET /api/documents/:id/download', () => {
    it('should generate Excel for a processed document', async () => {
      // Создаём документ с resultData напрямую в БД
      const ds = app.get(DataSource);
      const repo = ds.getRepository(Document);

      const doc = repo.create({
        telegramUserId,
        originalFileName: 'download-test.xlsx',
        columnMapping: { description: 0 },
        parsedData: sampleParsedData,
        resultData: [
          {
            description: 'Говядина',
            quantity: 10,
            price: 500,
            weight: 100,
            tnVedCode: '0201100001',
            tnVedDescription: 'Туши',
            dutyRate: 15,
            vatRate: 20,
            exciseRate: 0,
            totalPrice: 5000,
            dutyAmount: 750,
            vatAmount: 1150,
            exciseAmount: 0,
            logisticsCommission: 260,
            totalCost: 7160,
            verificationStatus: 'exact',
            matchConfidence: 0.85,
          },
        ],
        rowCount: 1,
        status: DocumentStatus.PROCESSED,
      });
      const saved = await repo.save(doc);

      const res = await request(app.getHttpServer())
        .get(`/api/documents/${saved.id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('download-test.xlsx');
      // supertest возвращает бинарный body как Buffer через .buffer(true)
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/documents/:id/download-internal', () => {
    it('should allow download via internal key', async () => {
      const ds = app.get(DataSource);
      const repo = ds.getRepository(Document);

      const doc = repo.create({
        telegramUserId,
        originalFileName: 'internal-download.xlsx',
        columnMapping: { description: 0 },
        parsedData: [{ description: 'Test' }],
        resultData: [{ description: 'Test' }],
        rowCount: 1,
        status: DocumentStatus.PROCESSED,
      });
      const saved = await repo.save(doc);

      const res = await request(app.getHttpServer())
        .get(`/api/documents/${saved.id}/download-internal`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
    });
  });

  describe('ExcelExportService', () => {
    it('should produce valid Excel with color-coded status column', async () => {
      const exportService = app.get(ExcelExportService);
      const ds = app.get(DataSource);
      const repo = ds.getRepository(Document);

      const doc = repo.create({
        telegramUserId,
        originalFileName: 'excel-test.xlsx',
        columnMapping: {},
        parsedData: [],
        resultData: [
          {
            description: 'Точное',
            quantity: 1,
            price: 100,
            weight: 1,
            tnVedCode: '0201100001',
            tnVedDescription: 'Тест',
            dutyRate: 15,
            vatRate: 20,
            exciseRate: 0,
            totalPrice: 100,
            dutyAmount: 15,
            vatAmount: 23,
            exciseAmount: 0,
            logisticsCommission: 5,
            totalCost: 143,
            verificationStatus: 'exact',
            matchConfidence: 0.9,
          },
          {
            description: 'Ручная проверка',
            quantity: 1,
            price: 50,
            weight: 1,
            tnVedCode: '',
            tnVedDescription: 'Не найден',
            dutyRate: 0,
            vatRate: 20,
            exciseRate: 0,
            totalPrice: 50,
            dutyAmount: 0,
            vatAmount: 10,
            exciseAmount: 0,
            logisticsCommission: 2.5,
            totalCost: 62.5,
            verificationStatus: 'review',
            matchConfidence: 0,
          },
        ],
        rowCount: 2,
        status: DocumentStatus.PROCESSED,
      });
      const saved = await repo.save(doc);

      const buffer = await exportService.generate(saved);
      expect(buffer).toBeDefined();
      expect(Buffer.byteLength(buffer as any)).toBeGreaterThan(100);
    });
  });
});
