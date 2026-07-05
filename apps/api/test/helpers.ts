import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient } from '@direct-port/tks-api';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AiParserService } from '../src/ai-parser/ai-parser.service';
import { CurrencyService } from '../src/currency/currency.service';
import { DEFAULT_COMPANY_ID } from '../src/common/tenant/actor-context';

// Modules
import { AuthModule } from '../src/auth/auth.module';
import { CalculationConfigModule } from '../src/calculation-config/calculation-config.module';
import { ClientPortalModule } from '../src/client-portal/client-portal.module';
import { CryptoModule } from '../src/common/crypto/crypto.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { DocumentsModule } from '../src/documents/documents.module';
import { DocumentsParsingProcessor } from '../src/documents/documents-parsing.processor';
import { DocumentsProcessor } from '../src/documents/documents.processor';
import { PipelineAuditModule } from '../src/pipeline-audit/pipeline-audit.module';
import { RedisModule, REDIS_CLIENT } from '../src/redis/redis.module';
import { TelegramUsersModule } from '../src/telegram-users/telegram-users.module';
import { TnVedModule } from '../src/tn-ved/tn-ved.module';
import { UsersModule } from '../src/users/users.module';

// Guards
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';

// Entities
import { AiCall } from '../src/database/entities/ai-call.entity';
import { AiConfig } from '../src/database/entities/ai-config.entity';
import { AiUsageLog } from '../src/database/entities/ai-usage-log.entity';
import { BillingAccount } from '../src/database/entities/billing-account.entity';
import { CalculationConfig } from '../src/database/entities/calculation-config.entity';
import { CalculationLog } from '../src/database/entities/calculation-log.entity';
import { Company } from '../src/database/entities/company.entity';
import { CompanyDomain } from '../src/database/entities/company-domain.entity';
import { ConversationMessage } from '../src/database/entities/conversation-message.entity';
import { DepositTransaction } from '../src/database/entities/deposit-transaction.entity';
import { Document } from '../src/database/entities/document.entity';
import { DocumentPhoto } from '../src/database/entities/document-photo.entity';
import { DocumentVersion } from '../src/database/entities/document-version.entity';
import { PipelineStageRun } from '../src/database/entities/pipeline-stage-run.entity';
import { RefreshToken } from '../src/database/entities/refresh-token.entity';
import { TelegramUser } from '../src/database/entities/telegram-user.entity';
import { TksCache } from '../src/database/entities/tks-cache.entity';
import { TnVedCode } from '../src/database/entities/tn-ved-code.entity';
import { TopUpRequest } from '../src/database/entities/top-up-request.entity';
import { User, UserRole } from '../src/database/entities/user.entity';

// Controllers
import { AppController } from '../src/app.controller';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://directport:directport@localhost:5434/directport_test';

process.env.API_INTERNAL_KEY = 'test-internal-key';

// Каждый e2e-suite использует свою Postgres schema и свой префикс ключей BullMQ.
// Why: иначе suite'ы пересекаются через shared БД (dropSchema одного затирает
// данные другого) и через shared Redis (воркер из предыдущего suite подхватывает
// job, пока следующий суит только стартует). При --runInBand jest запускает
// suite'ы последовательно, но async teardown Redis/Postgres уже в следующем
// процессе не завершён — и возникает flaky.
function uniqueSuffix(): string {
  return `${process.pid}_${Date.now()}_${randomBytes(3).toString('hex')}`;
}

async function withRawDataSource(fn: (ds: DataSource) => Promise<void>): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: TEST_DB_URL, entities: [] });
  await ds.initialize();
  try {
    await fn(ds);
  } finally {
    await ds.destroy();
  }
}

async function ensureSchema(schema: string): Promise<void> {
  await withRawDataSource(async (ds) => {
    await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.query(`CREATE SCHEMA "${schema}"`);
  });
}

async function dropSchemaSafely(schema: string): Promise<void> {
  await withRawDataSource(async (ds) => {
    await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });
}

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
      feasibility: 'ok',
      rejectionReasons: [],
      rejectionReasonsData: [],
      tokenUsage: {},
    }),
  };
}

// CurrencyService в e2e заменяется заглушкой, иначе фоновые BullMQ-воркеры
// (DocumentsProcessor → CurrencyService.getRate) стучат в живой cbr-xml-daily.ru.
// Фетч таймаутит 10 секунд, jobs не успевают завершиться до afterAll/closeTestApp,
// `worker.close()` виснет, `afterAll` ломается по 30-секундному Jest-хуку, и вслед
// за упавшим suite'ом каскадом отваливаются остальные (Postgres-схема не дропается).
// Курс 1 unit = 90 RUB — достаточно, чтобы пайплайн отработал детерминированно.
export function createMockCurrencyService(): Partial<CurrencyService> {
  const FIXED_RATE = 90;
  return {
    getRate: jest.fn().mockImplementation(async (from: string) => (from === 'RUB' ? 1 : FIXED_RATE)),
    toRub: jest
      .fn()
      .mockImplementation(async (amount: number, from: string) =>
        from === 'RUB' ? amount : Math.round(amount * FIXED_RATE * 100) / 100,
      ),
    toRubSync: (amount: number, rate: number) => Math.round(amount * rate * 100) / 100,
    // Без этого мока фоновый DocumentsProcessor падает на каждом документе
    // (this.currencyService.buildCurrencyToDocRates is not a function) и шумит в логах.
    buildCurrencyToDocRates: jest
      .fn()
      .mockImplementation(async (docCurrency: string, currencies: readonly string[]) => {
        const targets = Array.from(new Set([docCurrency, ...currencies]));
        const rubPerUnit: Record<string, number> = {};
        for (const c of targets) rubPerUnit[c] = c === 'RUB' ? 1 : FIXED_RATE;
        const docInRub = rubPerUnit[docCurrency] ?? 1;
        const map: Record<string, number> = {};
        for (const c of targets) map[c] = rubPerUnit[c] / docInRub;
        return map;
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

const APP_SCHEMA_KEY = Symbol('testSchema');

export async function createTestApp(): Promise<INestApplication> {
  const mockTksApi = createMockTksApi();
  const mockAiParser = createMockAiParser();
  const mockCurrency = createMockCurrencyService();

  const suffix = uniqueSuffix();
  const schema = `test_${suffix}`;
  const prefix = `tbull_${suffix}`;

  await ensureSchema(schema);

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
        schema,
        // Raw-SQL сервисов (manager.query: token-stats, dashboard) TypeORM схемой не
        // квалифицирует — направляем search_path соединений в схему suite'а, иначе
        // такие запросы бьют в public и видят чужие/несуществующие таблицы.
        extra: { options: `-c search_path=${schema},public` },
        entities: [
          AiConfig,
          AiUsageLog,
          User,
          Company,
          CompanyDomain,
          RefreshToken,
          TnVedCode,
          CalculationLog,
          TelegramUser,
          Document,
          DocumentPhoto,
          CalculationConfig,
          TksCache,
          PipelineStageRun,
          AiCall,
          DocumentVersion,
          ConversationMessage,
          BillingAccount,
          DepositTransaction,
          TopUpRequest,
        ],
        synchronize: true,
      }),
      BullModule.forRoot({ connection: { host: 'localhost', port: 6380 }, prefix }),
      RedisModule,
      // Глобальный CryptoModule (в проде даёт SecretCipher всем модулям через AppModule) — нужен
      // ClientPortalModule.TelegramVerifyService для расшифровки токенов ботов компаний.
      CryptoModule,
      PipelineAuditModule,
      AuthModule,
      UsersModule,
      TnVedModule,
      TelegramUsersModule,
      DocumentsModule,
      DashboardModule,
      CalculationConfigModule,
      ClientPortalModule,
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
    .overrideProvider(CurrencyService)
    .useValue(mockCurrency)
    // Реальный Redis не нужен для e2e — токены привязки менеджера мокаем.
    .overrideProvider(REDIS_CLIENT)
    .useValue({
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  // Инвариант системы (в реальной БД создаётся миграцией AddMultiTenancy): дефолтная
  // компания с фиксированным id. e2e гоняют схему через synchronize без миграций, поэтому
  // воспроизводим её здесь — иначе register/resolve и сид клиентов падают на NOT NULL / FK
  // company_id (клиент обязан принадлежать компании). См. docs/COMPANY_BOTS.md.
  const ds = app.get(DataSource);
  const companyRepo = ds.getRepository(Company);
  await companyRepo.save(companyRepo.create({ id: DEFAULT_COMPANY_ID, name: 'По умолчанию' }));

  // SQL-функция model_family в реальной БД создаётся миграцией AddModelFamilyFunction;
  // e2e-схемы поднимаются через synchronize без миграций — воспроизводим её (нужна
  // агрегациям token-stats и дашборда). Создаётся в схеме теста через search_path.
  await ds.query(`
    CREATE OR REPLACE FUNCTION model_family(m text) RETURNS text AS $$
      SELECT CASE
        WHEN m IS NULL THEN NULL
        WHEN m ILIKE '%haiku%' THEN 'haiku'
        WHEN m ILIKE '%sonnet%' THEN 'sonnet'
        WHEN m ILIKE '%opus%' THEN 'opus'
        ELSE m
      END
    $$ LANGUAGE SQL IMMUTABLE;
  `);

  (app as unknown as Record<symbol, string>)[APP_SCHEMA_KEY] = schema;

  return app;
}

// Закрывает BullMQ workers и queues до app.close(), чтобы Redis не падал
// на unhandled "Connection is closed" при teardown. После этого дропает
// схему БД — чтобы suite'ы не пересекались через shared Postgres.
// Why: NestJS зовёт shutdown hooks в порядке провайдеров, и queue может закрыть
// свою connection раньше, чем worker успеет завершиться — даёт unhandled error.
export async function closeTestApp(app: INestApplication): Promise<void> {
  const queueNames = [
    'document-parsing',
    'document-processing',
    'manager-notifications',
    'client-bot-outgoing',
  ];

  const processorClasses = [DocumentsProcessor, DocumentsParsingProcessor];
  for (const ProcessorClass of processorClasses) {
    try {
      const instance = app.get(ProcessorClass, { strict: false });
      if (instance?.worker) {
        await instance.worker.close();
      }
    } catch {
      // Не зарегистрирован в этом тесте
    }
  }

  for (const name of queueNames) {
    try {
      const queue = app.get<Queue>(getQueueToken(name), { strict: false });
      await queue.close();
    } catch {
      // Не зарегистрирован
    }
  }

  await app.close();

  const schema = (app as unknown as Record<symbol, string>)[APP_SCHEMA_KEY];
  if (schema) {
    try {
      await dropSchemaSafely(schema);
    } catch {
      // Не критично: временная схема, следующий suite получит свою
    }
  }
}

/**
 * Ждёт, пока все активные/waiting/delayed задачи BullMQ-очереди обработаются.
 * Нужно перед тестами, которые ставят `mockResolvedValueOnce` на сервис,
 * вызываемый из worker'а — иначе background-обработка из предыдущего it-блока
 * может съесть мок.
 */
export async function waitQueueIdle(
  app: INestApplication,
  queueName: string,
  timeoutMs = 5000,
): Promise<void> {
  const queue = app.get<Queue>(getQueueToken(queueName), { strict: false });
  if (!queue) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed');
    if ((counts.active ?? 0) + (counts.waiting ?? 0) + (counts.delayed ?? 0) === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// --- Seeders ---

export async function seedAdmin(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(User);

  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('admin123', 1);

  // super_admin (company_id = NULL) — видит все компании (scope=undefined), поэтому
  // существующие e2e на CRUD/листингах работают без привязки к конкретной компании.
  const admin = repo.create({
    email: 'admin@directport.ru',
    passwordHash,
    role: UserRole.SUPER_ADMIN,
    isActive: true,
  });
  return repo.save(admin);
}

export async function seedCompany(app: INestApplication, name = 'Test Co') {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(Company);
  return repo.save(repo.create({ name }));
}

export async function seedTnVed(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(TnVedCode);

  const codes = [
    {
      code: '0201',
      description: 'Мясо крупного рогатого скота, свежее или охлаждённое',
      unit: 'кг',
      dutyRate: 15,
      vatRate: 20,
      exciseRate: 0,
      level: 4,
    },
    {
      code: '0201100000',
      description: 'Туши и полутуши',
      unit: 'кг',
      dutyRate: 15,
      vatRate: 20,
      exciseRate: 0,
      parentCode: '0201',
      level: 10,
    },
    {
      code: '0901',
      description: 'Кофе, жареный или нежареный',
      unit: 'кг',
      dutyRate: 8,
      vatRate: 20,
      exciseRate: 0,
      level: 4,
    },
  ];

  return repo.save(codes.map((c) => repo.create(c)));
}

export async function seedTelegramUser(
  app: INestApplication,
  companyId: string = DEFAULT_COMPANY_ID,
) {
  const ds = app.get(DataSource);
  // Клиент обязан принадлежать компании (company_id NOT NULL, FK RESTRICT). Биллинг-аккаунт
  // тоже обязателен (billing_account_id NOT NULL) — заводим вместе с клиентом в той же компании.
  const accountRepo = ds.getRepository(BillingAccount);
  const account = await accountRepo.save(accountRepo.create({ balance: 0, companyId }));
  const repo = ds.getRepository(TelegramUser);
  return repo.save(
    repo.create({
      telegramId: '123456789',
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      companyId,
      billingAccountId: account.id,
    }),
  );
}

export async function seedCalculationConfig(app: INestApplication) {
  const ds = app.get(DataSource);
  const repo = ds.getRepository(CalculationConfig);
  return repo.save(
    repo.create({
      confidenceThreshold: 0.8,
      lowConfidenceAction: 'review',
    }),
  );
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

/**
 * Создаёт пользователя заданной роли в заданной компании (через API от лица super_admin,
 * токен которого передаётся) и логинит его — возвращает access-токен. Для e2e ролевого
 * доступа и tenant-скоупа: super_admin создаёт admin/customs с явной компанией.
 */
export async function createUserAndLogin(
  app: INestApplication,
  superAdminToken: string,
  opts: { email: string; role: 'admin' | 'customs'; companyId: string; password?: string },
): Promise<string> {
  const password = opts.password ?? 'password123';
  await request(app.getHttpServer())
    .post('/api/users')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ email: opts.email, password, role: opts.role, companyId: opts.companyId })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: opts.email, password })
    .expect(200);
  return res.body.accessToken;
}

export const INTERNAL_KEY_HEADER = { 'x-internal-key': 'test-internal-key' };
