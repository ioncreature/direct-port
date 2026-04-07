import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, INTERNAL_KEY_HEADER } from './helpers';

describe('TelegramUsers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
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
        .expect(401);
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
});
