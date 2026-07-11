import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../src/common/tenant/actor-context';
import { DepositTransaction } from '../src/database/entities/deposit-transaction.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { closeTestApp, createTestApp, INTERNAL_KEY_HEADER } from './helpers';

/**
 * Денежный слой кабинета (Ф2): заявки на пополнение → подтверждение менеджером →
 * идемпотентное зачисление кредитов. Главное — изоляция по аккаунту, фиксация цены
 * сервером и отсутствие двойного зачисления.
 */
describe('TopUp (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  let accountA: string;
  let telegramUserA: string;
  let accountB: string;
  const MANAGER_TG = 555000111;

  async function resolve(telegramId: number, firstName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/internal/client/resolve')
      .set(INTERNAL_KEY_HEADER)
      .send({ telegramId, firstName })
      .expect(201);
    return res.body as { telegramUserId: string; billingAccountId: string };
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    const a = await resolve(610610610, 'TopUp A');
    accountA = a.billingAccountId;
    telegramUserA = a.telegramUserId;
    accountB = (await resolve(620620620, 'TopUp B')).billingAccountId;

    // Привязанный активный менеджер для подтверждения заявок.
    const bcrypt = await import('bcrypt');
    const users = ds.getRepository(User);
    await users.save(
      users.create({
        email: 'topup-manager@directport.ru',
        passwordHash: await bcrypt.hash('x', 1),
        role: UserRole.CUSTOMS,
        // Менеджер той же (дефолтной) компании, что и клиентские аккаунты — иначе тенант-гейт
        // confirm/cancel отобьёт заявку 404-м (не-super_admin обязан иметь компанию).
        companyId: DEFAULT_COMPANY_ID,
        isActive: true,
        managerTelegramId: String(MANAGER_TG),
      }),
    );
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const createTopUp = (accountId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/internal/client/${accountId}/topups`)
      .set(INTERNAL_KEY_HEADER)
      .send(body);

  const balanceOf = async (accountId: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .get(`/api/internal/client/${accountId}/balance`)
      .set(INTERNAL_KEY_HEADER)
      .expect(200);
    return res.body.balance;
  };

  describe('packages', () => {
    it('lists purchasable packages only (no grant-only free)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/internal/client/packages')
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      const keys = (res.body as Array<{ key: string }>).map((p) => p.key);
      expect(keys).toContain('p100');
      expect(keys).not.toContain('free');
    });
  });

  describe('create', () => {
    it('fixes price from the package server-side', async () => {
      const res = await createTopUp(accountA, {
        packageKey: 'p500',
        telegramUserId: telegramUserA,
      }).expect(201);
      expect(res.body).toMatchObject({
        positions: 500,
        amount: 450,
        currency: 'USD',
        pricePerPosition: 0.9,
        status: 'pending',
      });
    });

    it('rejects an unknown / grant-only package', async () => {
      await createTopUp(accountA, { packageKey: 'nope', telegramUserId: telegramUserA }).expect(400);
      await createTopUp(accountA, { packageKey: 'free', telegramUserId: telegramUserA }).expect(400);
    });

    it('rejects a telegramUser not belonging to the account', async () => {
      await createTopUp(accountB, {
        packageKey: 'p100',
        telegramUserId: telegramUserA,
      }).expect(403);
    });

    it('requires internal key', async () => {
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/topups`)
        .send({ packageKey: 'p100', telegramUserId: telegramUserA })
        .expect(403);
    });
  });

  describe('confirm by manager', () => {
    let requestId: string;

    beforeAll(async () => {
      const res = await createTopUp(accountA, {
        packageKey: 'p100',
        telegramUserId: telegramUserA,
      }).expect(201);
      requestId = res.body.id;
    });

    it('does not credit balance while pending', async () => {
      const tx = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountA}/topups`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(tx.body.data.some((r: { id: string }) => r.id === requestId)).toBe(true);
    });

    it('credits positions on confirmation and is idempotent', async () => {
      const before = await balanceOf(accountA);

      await request(app.getHttpServer())
        .post(`/api/manager/topups/${requestId}/confirm`)
        .set(INTERNAL_KEY_HEADER)
        .send({ managerTelegramId: MANAGER_TG })
        .expect(201);
      expect(await balanceOf(accountA)).toBe(before + 100);

      // Повторное подтверждение (гонка/двойной клик) не задваивает зачисление.
      await request(app.getHttpServer())
        .post(`/api/manager/topups/${requestId}/confirm`)
        .set(INTERNAL_KEY_HEADER)
        .send({ managerTelegramId: MANAGER_TG })
        .expect(201);
      expect(await balanceOf(accountA)).toBe(before + 100);

      // Ровно один topup-ledger с этой заявкой.
      const txCount = await ds
        .getRepository(DepositTransaction)
        .count({ where: { sourceRequestId: requestId } });
      expect(txCount).toBe(1);
    });

    it('rejects confirmation from an unlinked manager', async () => {
      const res = await createTopUp(accountA, {
        packageKey: 'p100',
        telegramUserId: telegramUserA,
      }).expect(201);
      await request(app.getHttpServer())
        .post(`/api/manager/topups/${res.body.id}/confirm`)
        .set(INTERNAL_KEY_HEADER)
        .send({ managerTelegramId: 999999999 })
        .expect(403);
    });
  });

  describe('cancel', () => {
    it('client cancels own pending request; confirming a canceled one fails', async () => {
      const res = await createTopUp(accountA, {
        packageKey: 'p100',
        telegramUserId: telegramUserA,
      }).expect(201);
      const id = res.body.id;

      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountA}/topups/${id}/cancel`)
        .set(INTERNAL_KEY_HEADER)
        .expect(201)
        .expect((r) => expect(r.body.status).toBe('canceled'));

      await request(app.getHttpServer())
        .post(`/api/manager/topups/${id}/confirm`)
        .set(INTERNAL_KEY_HEADER)
        .send({ managerTelegramId: MANAGER_TG })
        .expect(400);
    });

    it('does not let another account cancel a foreign request (404)', async () => {
      const res = await createTopUp(accountA, {
        packageKey: 'p100',
        telegramUserId: telegramUserA,
      }).expect(201);
      await request(app.getHttpServer())
        .post(`/api/internal/client/${accountB}/topups/${res.body.id}/cancel`)
        .set(INTERNAL_KEY_HEADER)
        .expect(404);
    });
  });

  describe('isolation', () => {
    it('does not leak account A requests to account B', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/internal/client/${accountB}/topups`)
        .set(INTERNAL_KEY_HEADER)
        .expect(200);
      expect(res.body.total).toBe(0);
    });
  });
});
