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
} from './helpers';

describe('CalculationConfig (e2e)', () => {
  let app: INestApplication;
  // seedAdmin создаёт super_admin — настройки доступны только ему.
  let superAdminToken: string;
  // Обычный admin и customs сюда попадать не должны (settings — super_admin-only).
  let adminToken: string;
  let customsToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    const auth = await loginAsAdmin(app);
    superAdminToken = auth.accessToken;

    const company = await seedCompany(app);
    adminToken = await createUserAndLogin(app, superAdminToken, {
      email: 'admin-settings@test.com',
      role: 'admin',
      companyId: company.id,
    });
    customsToken = await createUserAndLogin(app, superAdminToken, {
      email: 'customs-settings@test.com',
      role: 'customs',
      companyId: company.id,
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('GET /api/calculation-config', () => {
    it('should return default config for super_admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(Number(res.body.confidenceThreshold)).toBeGreaterThanOrEqual(0);
      expect(Number(res.body.confidenceThreshold)).toBeLessThanOrEqual(1);
      expect(['review', 'reject']).toContain(res.body.lowConfidenceAction);
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer()).get('/api/calculation-config').expect(401);
    });

    it('should reject admin — settings are super_admin-only', async () => {
      await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('should reject customs — settings are super_admin-only', async () => {
      await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${customsToken}`)
        .expect(403);
    });

    it('should reject with internal key (requires role)', async () => {
      await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set(INTERNAL_KEY_HEADER)
        .expect(403);
    });
  });

  describe('PUT /api/calculation-config', () => {
    it('should update config as super_admin', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confidenceThreshold: 0.9, lowConfidenceAction: 'reject' })
        .expect(200);

      expect(Number(res.body.confidenceThreshold)).toBe(0.9);
      expect(res.body.lowConfidenceAction).toBe('reject');
    });

    it('should allow partial update', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confidenceThreshold: 0.5 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(Number(res.body.confidenceThreshold)).toBe(0.5);
      // Предыдущее значение сохранено
      expect(res.body.lowConfidenceAction).toBe('reject');
    });

    it('should reject out-of-range confidenceThreshold', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confidenceThreshold: 5 })
        .expect(400);
    });

    it('should reject non-numeric confidenceThreshold', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confidenceThreshold: 'abc' })
        .expect(400);
    });

    it('should reject admin — settings are super_admin-only', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ confidenceThreshold: 0.7 })
        .expect(403);
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .put('/api/calculation-config')
        .send({ confidenceThreshold: 0.7 })
        .expect(401);
    });
  });
});
