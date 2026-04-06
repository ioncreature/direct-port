import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, seedAdmin } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
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
          role: 'admin',
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

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
