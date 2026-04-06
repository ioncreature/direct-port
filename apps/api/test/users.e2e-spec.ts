import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, seedAdmin, loginAsAdmin } from './helpers';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await seedAdmin(app);
    ({ accessToken } = await loginAsAdmin(app));
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  describe('GET /api/users', () => {
    it('should return list of users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users')
        .set(auth())
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).not.toHaveProperty('passwordHash');
      expect(res.body[0]).toHaveProperty('email');
      expect(res.body[0]).toHaveProperty('role');
    });

    it('should reject without auth', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({
          email: 'customs1@test.com',
          password: 'password123',
          role: 'customs',
        })
        .expect(201);

      expect(res.body.email).toBe('customs1@test.com');
      expect(res.body.role).toBe('customs');
      expect(res.body.isActive).toBe(true);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('should reject duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({
          email: 'admin@directport.ru',
          password: 'password123',
          role: 'admin',
        })
        .expect(409);
    });

    it('should validate dto — invalid email', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'not-email', password: 'password123', role: 'admin' })
        .expect(400);
    });

    it('should validate dto — invalid role', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'new@test.com', password: 'password123', role: 'superadmin' })
        .expect(400);
    });

    it('should validate dto — missing fields', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return user by id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'findme@test.com', password: 'password123', role: 'customs' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/users/${created.body.id}`)
        .set(auth())
        .expect(200);

      expect(res.body.email).toBe('findme@test.com');
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('should return 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .get('/api/users/00000000-0000-0000-0000-000000000000')
        .set(auth())
        .expect(404);
    });

    it('should return 400 for invalid uuid', async () => {
      await request(app.getHttpServer())
        .get('/api/users/not-a-uuid')
        .set(auth())
        .expect(400);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('should update user fields', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'toupdate@test.com', password: 'password123', role: 'customs' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${created.body.id}`)
        .set(auth())
        .send({ email: 'updated@test.com', isActive: false })
        .expect(200);

      expect(res.body.email).toBe('updated@test.com');
      expect(res.body.isActive).toBe(false);
    });

    it('should update password', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'pwdchange@test.com', password: 'oldpass123', role: 'admin' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/users/${created.body.id}`)
        .set(auth())
        .send({ password: 'newpass123' })
        .expect(200);

      // Verify can login with new password
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'pwdchange@test.com', password: 'newpass123' })
        .expect(200);
    });

    it('should return 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/00000000-0000-0000-0000-000000000000')
        .set(auth())
        .send({ email: 'test@test.com' })
        .expect(404);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should delete user', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'todelete@test.com', password: 'password123', role: 'customs' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/users/${created.body.id}`)
        .set(auth())
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/users/${created.body.id}`)
        .set(auth())
        .expect(404);
    });

    it('should return 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .delete('/api/users/00000000-0000-0000-0000-000000000000')
        .set(auth())
        .expect(404);
    });
  });

  describe('Role-based access', () => {
    it('should deny customs user access to users endpoints', async () => {
      // Create customs user
      await request(app.getHttpServer())
        .post('/api/users')
        .set(auth())
        .send({ email: 'customs-role@test.com', password: 'password123', role: 'customs' })
        .expect(201);

      // Login as customs
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'customs-role@test.com', password: 'password123' })
        .expect(200);

      // Try to access admin-only endpoint
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(403);
    });
  });
});
