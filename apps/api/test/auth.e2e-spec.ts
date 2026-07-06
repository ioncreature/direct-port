import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { closeTestApp, createTestApp, loginAsAdmin, seedAdmin, seedCompany } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: 'admin123' })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user).toEqual(
        expect.objectContaining({
          email: 'admin@directport.ru',
          role: 'super_admin',
          companyId: null,
        }),
      );
      expect(res.body.user.id).toBeDefined();
    });

    it('should reject wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: 'wrongpassword' })
        .expect(401);
    });

    it('should reject non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@test.com', password: 'admin123' })
        .expect(401);
    });

    it('should validate dto — missing email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: 'admin123' })
        .expect(400);
    });

    it('should validate dto — password too short', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: '123' })
        .expect(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should issue new tokens with valid refresh token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: 'admin123' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(login.body.refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('should invalidate old refresh token after use', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: 'admin123' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      // Old token should no longer work
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and invalidate refresh token', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@directport.ru', password: 'admin123' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      // Refresh token should no longer work
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
    });

    it('should require auth to logout', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: 'some-token' })
        .expect(401);
    });
  });

  describe('JWT guard', () => {
    it('should reject requests without token to protected endpoints', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('should allow requests with valid internal key', async () => {
      // Use tn-ved endpoint — requires auth but no specific role
      const res = await request(app.getHttpServer())
        .get('/api/tn-ved?search=')
        .set('x-internal-key', 'test-internal-key')
        .expect(200);

      expect(res.body).toBeDefined();
      expect(res.body.results).toBeDefined();
    });
  });

  describe('POST /api/auth/login — тенант-гейт по домену', () => {
    const TENANT_DOMAIN = 'panel.tenant-example.com';
    const TENANT_USER = { email: 'tenant-user@test.ru', password: 'password123' };
    let companyId: string;

    beforeAll(async () => {
      const { accessToken } = await loginAsAdmin(app);
      companyId = (await seedCompany(app, 'Tenant Gate Co')).id;
      // Привязываем домен к компании и заводим её customs-пользователя (через super_admin).
      await request(app.getHttpServer())
        .patch(`/api/companies/${companyId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ domains: [TENANT_DOMAIN], theme: 'sky' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...TENANT_USER, role: 'customs', companyId })
        .expect(201);
    });

    it('пускает пользователя на домене его компании', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('x-tenant-host', TENANT_DOMAIN)
        .send(TENANT_USER)
        .expect(200);
    });

    it('нормализует хост с портом при сверке домена', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('x-tenant-host', `${TENANT_DOMAIN}:3000`)
        .send(TENANT_USER)
        .expect(200);
    });

    it('отклоняет пользователя на чужом/незарегистрированном домене', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('x-tenant-host', 'other-tenant.example.com')
        .send(TENANT_USER)
        .expect(401);
    });

    it('пускает пользователя без домена (гейт не против чего применять)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(TENANT_USER)
        .expect(200);
    });

    it('super_admin входит на домене любого тенанта (гейт не применяется)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('x-tenant-host', TENANT_DOMAIN)
        .send({ email: 'admin@directport.ru', password: 'admin123' })
        .expect(200);
    });

    it('GET /api/tenant/theme отдаёт тему и версию логотипа тенанта по домену (публичный)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenant/theme?domain=${TENANT_DOMAIN}`)
        .expect(200);
      expect(res.body).toEqual({
        theme: 'sky',
        logoVersion: null,
        faviconVersion: null,
        known: true,
      });
    });

    it('GET /api/tenant/theme на неизвестном домене отдаёт дефолтную тему', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenant/theme?domain=nope.example.com')
        .expect(200);
      expect(res.body).toEqual({
        theme: 'default',
        logoVersion: null,
        faviconVersion: null,
        known: false,
      });
    });

    it('GET /api/tenant/theme без домена отдаёт дефолтную тему', async () => {
      const res = await request(app.getHttpServer()).get('/api/tenant/theme').expect(200);
      expect(res.body).toEqual({
        theme: 'default',
        logoVersion: null,
        faviconVersion: null,
        known: false,
      });
    });
  });
});
