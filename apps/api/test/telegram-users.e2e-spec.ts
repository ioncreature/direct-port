import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  closeTestApp,
  createTestApp,
  createUserAndLogin,
  INTERNAL_KEY_HEADER,
  loginAsAdmin,
  seedAdmin,
  seedCompany,
  seedTelegramUser,
} from './helpers';

describe('TelegramUsers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/telegram-users/register', () => {
    it('should register a new telegram user via internal key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/telegram-users/register')
        .set(INTERNAL_KEY_HEADER)
        .send({
          telegramId: 111222333,
          username: 'johndoe',
          firstName: 'John',
          lastName: 'Doe',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.telegramId).toBe('111222333');
      expect(res.body.username).toBe('johndoe');
    });

    it('should upsert on duplicate telegramId', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/telegram-users/register')
        .set(INTERNAL_KEY_HEADER)
        .send({ telegramId: 999888777, username: 'original' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/telegram-users/register')
        .set(INTERNAL_KEY_HEADER)
        .send({ telegramId: 999888777, username: 'updated' })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.username).toBe('updated');
    });

    it('should reject without internal key', async () => {
      await request(app.getHttpServer())
        .post('/api/telegram-users/register')
        .send({ telegramId: 123 })
        .expect(403);
    });
  });

  describe('GET /api/telegram-users/:telegramId', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/telegram-users/register')
        .set(INTERNAL_KEY_HEADER)
        .send({ telegramId: 555666777, username: 'lookup_test' });
    });

    it('should find user by telegramId', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/telegram-users/555666777')
        .set(INTERNAL_KEY_HEADER)
        .expect(200);

      expect(res.body.telegramId).toBe('555666777');
      expect(res.body.username).toBe('lookup_test');
    });
  });

  // Роль customs (декларант) получила доступ к разделу Telegram, но строго в рамках
  // своей компании: findAll скоупит по actor.companyId, findOneById бьёт assertSameCompany.
  describe('GET /api/telegram-users (роль + tenant-скоуп)', () => {
    let customsToken: string;
    let companyA: string;
    let companyB: string;
    let aUserId: string;
    let bUserId: string;

    beforeAll(async () => {
      await seedAdmin(app);
      const { accessToken: superToken } = await loginAsAdmin(app);
      companyA = (await seedCompany(app, 'Company A')).id;
      companyB = (await seedCompany(app, 'Company B')).id;
      customsToken = await createUserAndLogin(app, superToken, {
        email: 'customs-scope@test.com',
        role: 'customs',
        companyId: companyA,
      });
      aUserId = (await seedTelegramUser(app, companyA)).id;
      bUserId = (await seedTelegramUser(app, companyB)).id;
    });

    it('customs видит клиентов только своей компании', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/telegram-users')
        .set('Authorization', `Bearer ${customsToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((u: { companyId: string }) => u.companyId === companyA)).toBe(
        true,
      );
      // Клиент чужой компании (companyB) в выдачу не попал.
      expect(res.body.data.some((u: { companyId: string }) => u.companyId === companyB)).toBe(
        false,
      );
    });

    it('customs открывает карточку клиента своей компании (200)', async () => {
      await request(app.getHttpServer())
        .get(`/api/telegram-users/by-id/${aUserId}`)
        .set('Authorization', `Bearer ${customsToken}`)
        .expect(200);
    });

    it('customs получает 404 на клиента чужой компании', async () => {
      await request(app.getHttpServer())
        .get(`/api/telegram-users/by-id/${bUserId}`)
        .set('Authorization', `Bearer ${customsToken}`)
        .expect(404);
    });

    it('customs смотрит операции по депозиту клиента своей компании (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/telegram-users/by-id/${aUserId}/deposit-transactions`)
        .set('Authorization', `Bearer ${customsToken}`)
        .expect(200);
      expect(res.body).toHaveProperty('data');
    });

    it('customs управляет балансом клиента своей компании (корректировка)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/telegram-users/by-id/${aUserId}/deposit`)
        .set('Authorization', `Bearer ${customsToken}`)
        .send({ amount: 10, comment: 'e2e credit' })
        .expect(201);
      expect(res.body.balance).toBe(10);
    });

    it('customs не может трогать депозит клиента чужой компании (404)', async () => {
      await request(app.getHttpServer())
        .post(`/api/telegram-users/by-id/${bUserId}/deposit`)
        .set('Authorization', `Bearer ${customsToken}`)
        .send({ amount: 10 })
        .expect(404);
    });
  });
});
