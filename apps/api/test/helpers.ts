import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { TnVedModule } from '../src/tn-ved/tn-ved.module';
import { AppController } from '../src/app.controller';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { APP_GUARD } from '@nestjs/core';
import { User } from '../src/database/entities/user.entity';
import { RefreshToken } from '../src/database/entities/refresh-token.entity';
import { TnVedCode } from '../src/database/entities/tn-ved-code.entity';
import { CalculationLog } from '../src/database/entities/calculation-log.entity';
import { DataSource } from 'typeorm';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://directport:directport@localhost:5434/directport_test';

// JwtAuthGuard reads process.env directly for internal key
process.env.API_INTERNAL_KEY = 'test-internal-key';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            DATABASE_URL: TEST_DB_URL,
            JWT_SECRET: 'test-jwt-secret',
            JWT_ACCESS_EXPIRATION: '15m',
            API_INTERNAL_KEY: 'test-internal-key',
          }),
        ],
        ignoreEnvFile: true,
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: TEST_DB_URL,
        entities: [User, RefreshToken, TnVedCode, CalculationLog],
        synchronize: true,
        dropSchema: true,
      }),
      AuthModule,
      UsersModule,
      TnVedModule,
    ],
    controllers: [AppController],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  return app;
}

export async function seedAdmin(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(User);

  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = repo.create({
    email: 'admin@directport.ru',
    passwordHash,
    role: 'admin' as any,
    isActive: true,
  });
  return repo.save(admin);
}

export async function seedTnVed(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(TnVedCode);

  const codes = [
    { code: '0201', description: 'Мясо крупного рогатого скота, свежее или охлаждённое', unit: 'кг', dutyRate: 15, vatRate: 20, exciseRate: 0, level: 4 },
    { code: '0201100000', description: 'Туши и полутуши', unit: 'кг', dutyRate: 15, vatRate: 20, exciseRate: 0, parentCode: '0201', level: 10 },
    { code: '0901', description: 'Кофе, жареный или нежареный', unit: 'кг', dutyRate: 8, vatRate: 20, exciseRate: 0, level: 4 },
  ];

  return repo.save(codes.map((c) => repo.create(c)));
}

export async function loginAsAdmin(
  app: INestApplication,
): Promise<{ accessToken: string; refreshToken: string }> {
  const server = app.getHttpServer();
  const res = await request(server)
    .post('/api/auth/login')
    .send({ email: 'admin@directport.ru', password: 'admin123' })
    .expect(200);

  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}
