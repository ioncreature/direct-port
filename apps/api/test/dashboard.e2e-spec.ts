import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../src/common/tenant/actor-context';
import { BillingAccount } from '../src/database/entities/billing-account.entity';
import { DepositTransaction } from '../src/database/entities/deposit-transaction.entity';
import { Document, DocumentStatus } from '../src/database/entities/document.entity';
import { TopUpRequest } from '../src/database/entities/top-up-request.entity';
import {
  closeTestApp,
  createTestApp,
  createUserAndLogin,
  loginAsAdmin,
  seedAdmin,
  seedCompany,
  seedTelegramUser,
} from './helpers';

/** Успешно посчитанная строка resultData с заданными рублёвыми платежами. */
function okRow(payments: { duty?: number; vat?: number; excise?: number } = {}) {
  return {
    description: 'Товар',
    calculationStatus: 'ok',
    dutyAmountRub: payments.duty ?? 0,
    vatAmountRub: payments.vat ?? 0,
    exciseAmountRub: payments.excise ?? 0,
  };
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let superToken: string;
  let adminToken: string;
  let customsToken: string;
  let otherCompanyId: string;

  const get = (token: string, params: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get('/api/dashboard/stats')
      .query(params)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await seedAdmin(app);
    ({ accessToken: superToken } = await loginAsAdmin(app));

    const other = await seedCompany(app, 'Другая компания');
    otherCompanyId = other.id;
    adminToken = await createUserAndLogin(app, superToken, {
      email: 'admin-d@test.ru',
      role: 'admin',
      companyId: DEFAULT_COMPANY_ID,
    });
    customsToken = await createUserAndLogin(app, superToken, {
      email: 'customs-d@test.ru',
      role: 'customs',
      companyId: DEFAULT_COMPANY_ID,
    });

    // Клиенты: по одному в каждой компании (уникальность — пара company+telegram_id).
    const tgDefault = await seedTelegramUser(app);
    const tgOther = await seedTelegramUser(app, otherCompanyId);
    await ds.getRepository(BillingAccount).update({ id: tgDefault.billingAccountId }, { balance: 40 });

    const docRepo = ds.getRepository(Document);
    // A: обработан сейчас, 2 успешные строки (380.5 ₽ платежей) + 1 с ошибкой расчёта.
    await docRepo.save(
      docRepo.create({
        companyId: DEFAULT_COMPANY_ID,
        telegramUserId: tgDefault.id,
        originalFileName: 'a.xlsx',
        status: DocumentStatus.PROCESSED,
        rowCount: 3,
        resultData: [
          okRow({ duty: 100.5, vat: 200 }),
          okRow({ duty: 50, vat: 30 }),
          { description: 'Ошибка', calculationStatus: 'error' },
        ],
      }),
    );
    // B: сбой без resultData.
    await docRepo.save(
      docRepo.create({
        companyId: DEFAULT_COMPANY_ID,
        originalFileName: 'b.xlsx',
        status: DocumentStatus.FAILED,
        rowCount: 1,
      }),
    );
    // C: обработан 10 дней назад (внутри month, вне week).
    const docC = await docRepo.save(
      docRepo.create({
        companyId: DEFAULT_COMPANY_ID,
        originalFileName: 'c.xlsx',
        status: DocumentStatus.PROCESSED,
        rowCount: 2,
        resultData: [okRow({ vat: 10 }), okRow({ vat: 10 })],
      }),
    );
    await ds.query(`UPDATE documents SET created_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [
      docC.id,
    ]);
    // D: документ другой компании, 5 успешных строк без рублёвых полей
    // (курс ЦБ недоступен — платежи не считаются, но позиции обработаны).
    await docRepo.save(
      docRepo.create({
        companyId: otherCompanyId,
        telegramUserId: tgOther.id,
        originalFileName: 'd.xlsx',
        status: DocumentStatus.PROCESSED,
        rowCount: 5,
        resultData: Array.from({ length: 5 }, () => ({ description: 'OK' })),
      }),
    );

    const txRepo = ds.getRepository(DepositTransaction);
    const tx = (
      accountId: string,
      delta: number,
      type: DepositTransaction['type'],
      documentId: string | null = null,
    ) =>
      txRepo.create({
        billingAccountId: accountId,
        delta,
        type,
        balanceAfter: 0,
        documentId,
      });
    await txRepo.save([
      tx(tgDefault.billingAccountId, 50, 'topup'),
      tx(tgDefault.billingAccountId, 5, 'grant'), // не выручка — не входит в пополнения
      tx(tgDefault.billingAccountId, -2, 'charge', docC.id),
      tx(tgDefault.billingAccountId, 1, 'adjustment', docC.id), // возврат пересчёта — уменьшает списания
      tx(tgDefault.billingAccountId, -3, 'adjustment'), // ручная корректировка — вне потоков
      tx(tgOther.billingAccountId, 7, 'topup'),
    ]);
    // Старое пополнение за пределами окна month.
    const oldTopUp = await txRepo.save(tx(tgDefault.billingAccountId, 100, 'topup'));
    await ds.query(
      `UPDATE deposit_transactions SET created_at = NOW() - INTERVAL '40 days' WHERE id = $1`,
      [oldTopUp.id],
    );

    const topUpRepo = ds.getRepository(TopUpRequest);
    const topUpRequest = (accountId: string, tgUserId: string, status: 'pending' | 'confirmed') =>
      topUpRepo.create({
        billingAccountId: accountId,
        createdByTelegramUserId: tgUserId,
        positions: 100,
        amount: 100,
        currency: 'USD',
        pricePerPosition: 1,
        status,
      });
    await topUpRepo.save([
      topUpRequest(tgDefault.billingAccountId, tgDefault.id, 'pending'),
      topUpRequest(tgDefault.billingAccountId, tgDefault.id, 'confirmed'),
      topUpRequest(tgOther.billingAccountId, tgOther.id, 'pending'),
    ]);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('requires auth', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/stats').expect(401);
  });

  it('rejects unknown period', async () => {
    await get(superToken, { period: 'decade' }).expect(400);
  });

  it('super_admin: aggregates across all companies for default month period', async () => {
    const res = await get(superToken).expect(200);
    const body = res.body;

    expect(body.period).toBe('month');
    expect(body.granularity).toBe('day');
    expect(body.documents.total).toBe(4);
    expect(body.documents.byStatus.processed).toBe(3);
    expect(body.documents.byStatus.failed).toBe(1);

    expect(body.positions).toEqual({
      total: 10,
      successful: 9,
      customsPaymentsRub: 400.5,
    });

    expect(body.clients).toEqual({ total: 2, new: 2, active: 2 });
    expect(body.billing).toEqual({
      totalBalance: 40,
      topUpPositions: 57,
      chargedPositions: 1,
      pendingTopUps: 2,
    });

    // super_admin + admin-d + customs-d
    expect(body.users).toBe(3);
    expect(body.ai).toEqual({ models: {}, leads: {} });

    expect(body.series).toHaveLength(30);
    const seriesDocs = body.series.reduce((s: number, p: { documents: number }) => s + p.documents, 0);
    const seriesPositions = body.series.reduce(
      (s: number, p: { positions: number }) => s + p.positions,
      0,
    );
    expect(seriesDocs).toBe(4);
    expect(seriesPositions).toBe(10);

    expect(body.recentDocuments).toHaveLength(4);
    expect(body.recentDocuments[0]).toEqual(
      expect.objectContaining({ originalFileName: expect.any(String), status: expect.any(String) }),
    );
  });

  it('super_admin: filters by company', async () => {
    const res = await get(superToken, { companyId: otherCompanyId }).expect(200);
    const body = res.body;

    expect(body.documents.total).toBe(1);
    expect(body.positions).toEqual({ total: 5, successful: 5, customsPaymentsRub: 0 });
    expect(body.clients).toEqual({ total: 1, new: 1, active: 1 });
    expect(body.billing).toEqual({
      totalBalance: 0,
      topUpPositions: 7,
      chargedPositions: 0,
      pendingTopUps: 1,
    });
    // Лиды — платформенный расход: в скоупе компании не считаются.
    expect(body.ai.leads).toBeNull();
    expect(body.recentDocuments).toHaveLength(1);
  });

  it('super_admin: week period excludes older documents', async () => {
    const res = await get(superToken, { period: 'week' }).expect(200);
    expect(res.body.documents.total).toBe(3);
    expect(res.body.documents.byStatus.processed).toBe(2);
    expect(res.body.positions.total).toBe(8);
    expect(res.body.series).toHaveLength(7);
  });

  it('super_admin: year period uses monthly granularity', async () => {
    const res = await get(superToken, { period: 'year' }).expect(200);
    expect(res.body.granularity).toBe('month');
    expect(res.body.documents.total).toBe(4);
    for (const point of res.body.series) {
      expect(point.date).toMatch(/^\d{4}-\d{2}$/);
    }
    const positions = res.body.series.reduce(
      (s: number, p: { positions: number }) => s + p.positions,
      0,
    );
    expect(positions).toBe(10);
  });

  it('company admin: scoped to own company, companyId query is ignored', async () => {
    const res = await get(adminToken, { companyId: otherCompanyId }).expect(200);
    const body = res.body;

    expect(body.documents.total).toBe(3);
    expect(body.positions.total).toBe(5);
    expect(body.positions.customsPaymentsRub).toBe(400.5);
    expect(body.clients.total).toBe(1);
    expect(body.billing).toEqual({
      totalBalance: 40,
      topUpPositions: 50,
      chargedPositions: 1,
      pendingTopUps: 1,
    });
    expect(body.users).toBe(2);
    expect(body.ai).not.toBeNull();
    expect(body.ai.leads).toBeNull();
  });

  it('customs: gets stats without admin metrics', async () => {
    const res = await get(customsToken).expect(200);
    expect(res.body.documents.total).toBe(3);
    expect(res.body.users).toBeNull();
    expect(res.body.ai).toBeNull();
    expect(res.body.billing.totalBalance).toBe(40);
  });
});
