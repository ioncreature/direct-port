import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './helpers';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api', () => {
    it('should return health check without auth (public)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api')
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});
