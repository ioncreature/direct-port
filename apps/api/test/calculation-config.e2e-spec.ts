import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, seedAdmin, loginAsAdmin, INTERNAL_KEY_HEADER } from './helpers';

describe('CalculationConfig (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    const auth = await loginAsAdmin(app);
    adminToken = auth.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/calculation-config', () => {
    it('should return default config for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(Number(res.body.pricePercent)).toBeGreaterThanOrEqual(0);
      expect(Number(res.body.weightRate)).toBeGreaterThanOrEqual(0);
      expect(Number(res.body.fixedFee)).toBeGreaterThanOrEqual(0);
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/calculation-config')
        .expect(401);
    });

    it('should reject with internal key (requires role)', async () => {
      await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set(INTERNAL_KEY_HEADER)
        .expect(403);
    });
  });

  describe('PUT /api/calculation-config', () => {
    it('should update config as admin', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pricePercent: 7.5, weightRate: 3, fixedFee: 15 })
        .expect(200);

      expect(Number(res.body.pricePercent)).toBe(7.5);
      expect(Number(res.body.weightRate)).toBe(3);
      expect(Number(res.body.fixedFee)).toBe(15);
    });

    it('should allow partial update', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pricePercent: 10 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Number(res.body.pricePercent)).toBe(10);
      // Предыдущие значения сохранены
      expect(Number(res.body.weightRate)).toBe(3);
      expect(Number(res.body.fixedFee)).toBe(15);
    });

    it('should reject negative values', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pricePercent: -5 })
        .expect(400);
    });

    it('should reject non-numeric values', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pricePercent: 'abc' })
        .expect(400);
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .send({ pricePercent: 5 })
        .expect(401);
    });
  });
});
