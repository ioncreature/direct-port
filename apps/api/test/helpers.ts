import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as request from 'supertest';
import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient } from '@direct-port/tks-api';
import { AiParserService } from '../src/ai-parser/ai-parser.service';
import { APP_GUARD } from '@nestjs/core';
import { DataSource } from 'typeorm';

// Modules
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { TnVedModule } from '../src/tn-ved/tn-ved.module';
import { TelegramUsersModule } from '../src/telegram-users/telegram-users.module';
import { DocumentsModule } from '../src/documents/documents.module';
import { CalculationConfigModule } from '../src/calculation-config/calculation-config.module';

// Guards
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';

// Entities
import { User, UserRole } from '../src/database/entities/user.entity';
import { RefreshToken } from '../src/database/entities/refresh-token.entity';
import { TnVedCode } from '../src/database/entities/tn-ved-code.entity';
import { CalculationLog } from '../src/database/entities/calculation-log.entity';
import { TelegramUser } from '../src/database/entities/telegram-user.entity';
import { Document } from '../src/database/entities/document.entity';
import { CalculationConfig } from '../src/database/entities/calculation-config.entity';

// Controllers
import { AppController } from '../src/app.controller';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://directport:directport@localhost:5434/directport_test';

process.env.API_INTERNAL_KEY = 'test-internal-key';

// --- Mock TKS API ---

export function createMockAiParser(): Partial<AiParserService> {
  return {
    parse: jest.fn().mockResolvedValue({
      products: [
        { description: 'Тестовый товар', quantity: 10, price: 500, weight: 100 },
        { description: 'Кофе растворимый', quantity: 5, price: 200, weight: 25 },
      ],
      currency: 'USD',
      columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
      confident: true,
    }),
  };
}

export function createMockTksApi(): Partial<TksApiClient> {
  return {
    searchGoodsGrouped: jest.fn().mockResolvedValue({
      data: [
        { CODE: '0201100001', KR_NAIM: 'Мясо КРС', CNT: 50 },
        { CODE: '0201200001', KR_NAIM: 'Прочее мясо', CNT: 10 },
      ],
      hm: 60,
      page: 1,
      per_page: 20,
    }),
    getTnvedCode: jest.fn().mockResolvedValue({
      CODE: '0201100001',
      KR_NAIM: 'Туши и полутуши',
      TNVED: {
        IMP: 15,
        NDS: 20,
        AKC: 0,
        IMPSIGN: null,
        IMP2: null,
        IMPEDI2: null,
      },
    }),
    searchGoods: jest.fn().mockResolvedValue({ data: [], hm: 0, page: 1, per_page: 20 }),
  };
}

// --- App factory ---

export async function createTestApp(): Promise<INestApplication> {
  const mockTksApi = createMockTksApi();
  const mockAiParser = createMockAiParser();

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
            TKS_API_BASE_URL: 'https://api1.tks.ru',
            TKS_TNVED_API_KEY: 'test-tnved-key',
            TKS_GOODS_API_KEY: 'test-goods-key',
          }),
        ],
        ignoreEnvFile: true,
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: TEST_DB_URL,
        entities: [User, RefreshToken, TnVedCode, CalculationLog, TelegramUser, Document, CalculationConfig],
        synchronize: true,
        dropSchema: true,
      }),
      BullModule.forRoot({ connection: { host: 'localhost', port: 6380 } }),
      AuthModule,
      UsersModule,
      TnVedModule,
      TelegramUsersModule,
      DocumentsModule,
      CalculationConfigModule,
    ],
    controllers: [AppController],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })
    .overrideProvider(TksApiClient)
    .useValue(mockTksApi)
    .overrideProvider(Anthropic)
    .useValue(null)
    .overrideProvider(AiParserService)
    .useValue(mockAiParser)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  return app;
}

// --- Seeders ---

export async function seedAdmin(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(User);

  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('admin123', 1);

  const admin = repo.create({
    email: 'admin@directport.ru',
    passwordHash,
    role: UserRole.ADMIN,
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

export async function seedTelegramUser(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(TelegramUser);
  return repo.save(repo.create({
    telegramId: '123456789',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
  }));
}

export async function seedCalculationConfig(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(CalculationConfig);
  return repo.save(repo.create({
    pricePercent: 5,
    weightRate: 2,
    fixedFee: 10,
  }));
}

// --- Auth helpers ---

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

export const INTERNAL_KEY_HEADER = { 'x-internal-key': 'test-internal-key' };
