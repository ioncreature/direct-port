import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, loginAsAdmin, seedAdmin, seedTnVed } from './helpers';

describe('TN VED (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    await seedTnVed(app);
    ({ accessToken } = await loginAsAdmin(app));
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  describe('GET /api/tn-ved', () => {
    it('should search by code prefix', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved?search=0201')
        .set(auth())
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].code).toBe('0201');
      expect(res.body[1].code).toBe('0201100000');
    });

    it('should search by description (case-insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved?search=кофе')
        .set(auth())
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].code).toBe('0901');
    });

    it('should return empty array for no matches', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved?search=zzzzz')
        .set(auth())
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return all codes with empty search', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved?search=')
        .set(auth())
        .expect(200);

      expect(res.body.length).toBe(3);
    });

    it('should require auth', async () => {
      await request(app.getHttpServer()).get('/api/tn-ved?search=02').expect(401);
    });
  });

  describe('GET /api/tn-ved/:code', () => {
    it('should find by exact code', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved/0201')
        .set(auth())
        .expect(200);

      expect(res.body.code).toBe('0201');
      expect(res.body.description).toContain('Мясо');
      expect(res.body.dutyRate).toBeDefined();
      expect(res.body.vatRate).toBeDefined();
    });

    it('should return null for non-existent code', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved/9999999999')
        .set(auth())
        .expect(200);

      expect(res.body).toEqual({});
    });
  });
});
