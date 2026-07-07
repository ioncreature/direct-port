import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { BillingAccount } from '../src/database/entities/billing-account.entity';
import { Document, DocumentStatus } from '../src/database/entities/document.entity';
import { TelegramUser } from '../src/database/entities/telegram-user.entity';
import { DEFAULT_COMPANY_ID } from '../src/common/tenant/actor-context';
import {
  closeTestApp,
  createTestApp,
  INTERNAL_KEY_HEADER,
  loginAsAdmin,
  seedAdmin,
} from './helpers';

/**
 * Client-scoped internal API кабинета (/internal/client/*). Главное, что проверяем —
 * изоляция по billingAccountId: чужой документ/история недоступны, и всё закрыто
 * X-Internal-Key.
 */
describe('ClientPortal (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;

  // Аккаунт A с одним документом, аккаунт B — пустой (для проверки изоляции).
  let accountA: string;
  let telegramUserAId: string;
  let accountB: string;
  let documentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await seedAdmin(app);
    adminToken = (await loginAsAdmin(app)).accessToken;

    // Аккаунт A заводим через сам resolve — заодно покрываем upsert+создание BillingAccount.
    const resolved = await request(app.getHttpServer())
      .post('/api/internal/client/resolve')
      .set(INTERNAL_KEY_HEADER)
      .send({ telegramId: 700700700, firstName: 'Cabinet', username: 'cab_a' })
      .expect(201);
    accountA = resolved.body.billingAccountId;
    telegramUserAId = resolved.body.telegramUserId;
    expect(accountA).toBeDefined();
    expect(telegramUserAId).toBeDefined();

    // Аккаунт B — отдельный клиент.
    const resolvedB = await request(app.getHttpServer())
      .post('/api/internal/client/resolve')
      .set(INTERNAL_KEY_HEADER)
      .send({ telegramId: 800800800, firstName: 'Other' })
      .expect(201);
    accountB = resolvedB.body.billingAccountId;
    expect(accountB).not.toBe(accountA);

    // Документ аккаунта A в статусе PROCESSED с минимальным resultData (для download).
    const docRepo = ds.getRepository(Document);
    const doc = await docRepo.save(
      docRepo.create({
        telegramUserId: telegramUserAId,
        source: 'managed',
        originalFileName: 'cabinet.xlsx',
        status: DocumentStatus.PROCESSED,
        currency: 'USD',
        rowCount: 1,
        parsedData: [{ description: 'Товар', quantity: 1, price: 100, weight: 10 }],
        resultData: [
          {
            description: 'Товар',
            quantity: 1,
            price: 100,
            weight: 10,
            tnVedCode: '0201100001',
            tnVedDescription: 'Туши и полутуши',
            dutyRate: 15,
            vatRate: 20,
            totalPrice: 100,
            dutyAmount: 15,
            vatAmount: 23,
            exciseAmount: 0,
            totalCost: 138,
            calculationStatus: 'exact',
            notes: [],
          },
        ],
      }),
    );
    documentId = doc.id;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('auth', () => {
    it('rejects without internal key', async () => {
      await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/balance`)
        .expect(403);
    });

    it('rejects a JWT user (internal-only namespace)', async () => {
      await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/balance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  describe('POST /resolve', () => {
    it('is idempotent on repeat telegramId (same account)', async () => {
      const again = await request(app.getHttpServer())
        .post('/api/internal/client/resolve')
        .set(INTERNAL_KEY_HEADER)
        .send({ telegramId: 700700700, username: 'cab_a_renamed' })
        .expect(201);
      expect(again.body.billingAccountId).toBe(accountA);
      expect(again.body.telegramUserId).toBe(telegramUserAId);
    });
  });

  describe('balance & transactions', () => {
    it('fresh account starts with the welcome grant (первые 50 позиций бесплатно)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/balance`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(res.body.balance).toBe(50);
    });

    it('reflects a manager top-up and lists it in transactions', async () => {
      await request(app.getHttpServer())
        .post(`/api/telegram-users/by-id/${telegramUserAId}/deposit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, comment: 'тест' })
        .expect(201);

      const balance = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/balance`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      // 50 welcome-grant + 50 пополнение менеджером.
      expect(balance.body.balance).toBe(100);

      const tx = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/transactions`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(tx.body.total).toBe(2);
      expect(tx.body.data[0]).toMatchObject({ delta: 50, type: 'topup', balanceAfter: 100 });
      expect(tx.body.data[1]).toMatchObject({ delta: 50, type: 'grant', balanceAfter: 50 });
    });

    it('does not leak account A transactions to account B', async () => {
      const tx = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/transactions`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      // Только собственный welcome-grant аккаунта B — пополнение аккаунта A не видно.
      expect(tx.body.total).toBe(1);
      expect(tx.body.data[0]).toMatchObject({ type: 'grant', delta: 50 });
    });
  });

  describe('documents', () => {
    it('lists only own documents', async () => {
      const own = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(own.body.total).toBe(1);
      expect(own.body.data[0]).toMatchObject({
        id: documentId,
        originalFileName: 'cabinet.xlsx',
        status: 'processed',
        rowCount: 1,
      });
      // Лёгкая карточка — без тяжёлых полей.
      expect(own.body.data[0].resultData).toBeUndefined();

      const otherList = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(otherList.body.total).toBe(0);
    });

    it('returns detail with resultData for own document', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/documents/${documentId}`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(res.body.id).toBe(documentId);
      expect(Array.isArray(res.body.resultData)).toBe(true);
      expect(res.body.resultData[0].tnVedCode).toBe('0201100001');
    });

    it('hides another account document (404, not 403 — no existence leak)', async () => {
      await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/documents/${documentId}`)
        .set(INTERNAL_KEY_HEADER)
        .expect(404);
    });

    it('downloads Excel for own PROCESSED document', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/documents/${documentId}/download`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/DP_.*\.xlsx/);
    });

    it('does not allow another account to download', async () => {
      await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/documents/${documentId}/download`)
        .set(INTERNAL_KEY_HEADER)
        .expect(404);
    });

    it('refuses download for a non-PROCESSED document', async () => {
      const docRepo = ds.getRepository(Document);
      const tgRepo = ds.getRepository(TelegramUser);
      const accRepo = ds.getRepository(BillingAccount);
      const account = await accRepo.save(
        accRepo.create({ balance: 0, companyId: DEFAULT_COMPANY_ID }),
      );
      const tg = await tgRepo.save(
        tgRepo.create({
          telegramId: '900900900',
          companyId: DEFAULT_COMPANY_ID,
          billingAccountId: account.id,
        }),
      );
      const pending = await docRepo.save(
        docRepo.create({
          telegramUserId: tg.id,
          source: 'managed',
          originalFileName: 'pending.xlsx',
          status: DocumentStatus.PARSING,
          rowCount: 1,
        }),
      );
      await request(app.getHttpServer())
        .get(`/api/internal/client/${account.id}/documents/${pending.id}/download`)
        .set(INTERNAL_KEY_HEADER)
        .expect(404);
    });
  });

  describe('self-service upload (Ф3)', () => {
    const csv = () => Buffer.from('description,price,weight,quantity\nТовар,100,10,1\n');

    it('creates a self_service document for own account and starts the pipeline', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .field('telegramUserId', telegramUserAId)
        .attach('file', csv(), 'goods.csv')
        .expect(201);
      expect(res.body).toMatchObject({ originalFileName: 'goods.csv', status: 'parsing' });
      expect(res.body.id).toBeDefined();

      const saved = await ds.getRepository(Document).findOne({ where: { id: res.body.id } });
      expect(saved?.source).toBe('self_service');
      expect(saved?.telegramUserId).toBe(telegramUserAId);
      expect(saved?.status).toBe(DocumentStatus.PARSING);
    });

    it('rejects a member that does not belong to the account (403, no cross-account upload)', async () => {
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountB}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .field('telegramUserId', telegramUserAId)
        .attach('file', csv(), 'goods.csv')
        .expect(403);
    });

    it('rejects an unsupported file extension (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .field('telegramUserId', telegramUserAId)
        .attach('file', csv(), 'goods.txt')
        .expect(400);
    });

    it('requires a file (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/documents`)
        .set(INTERNAL_KEY_HEADER)
        .field('telegramUserId', telegramUserAId)
        .expect(400);
    });

    it('is closed to non-internal callers (403)', async () => {
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/documents`)
        .field('telegramUserId', telegramUserAId)
        .attach('file', csv(), 'goods.csv')
        .expect(403);
    });
  });
});
