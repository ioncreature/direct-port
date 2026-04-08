# Dev-окружение

## Требования

- Node.js 24+
- pnpm 10+
- Docker и Docker Compose
- PM2 (`npm i -g pm2`)

## Быстрый старт

```bash
# Установить зависимости
pnpm install

# Поднять инфраструктуру (Postgres, Redis)
pnpm infra

# Скопировать переменные окружения
cp apps/api/.env.example apps/api/.env
cp apps/tg-bot/.env.example apps/tg-bot/.env
cp apps/admin-web/.env.example apps/admin-web/.env

# Запустить приложения (миграции + seed автоматически)
pnpm dev
```

## Инфраструктура

Docker Compose поднимает:

| Сервис   | Порт | Credentials                |
|----------|------|----------------------------|
| Postgres | 5434 | directport / directport    |
| Redis    | 6380 | —                          |

```bash
pnpm infra          # запуск
pnpm infra:stop     # остановка
pnpm infra:logs     # логи
```

## Приложения

PM2 управляет dev-процессами (ecosystem.config.js):

| Приложение | Порт | Путь           | Стек             |
|------------|------|----------------|------------------|
| API        | 3001 | apps/api       | NestJS + TypeORM |
| Admin Web  | 3000 | apps/admin-web | Next.js          |
| TG Bot     | 3002 | apps/tg-bot    | NestJS + grammY  |

```bash
pnpm dev            # запуск через PM2
pnpm dev:stop       # остановка
pnpm dev:logs       # логи
pnpm dev:status     # статус процессов
```

## API

### Модули

- **Auth** — JWT-авторизация (access + refresh tokens), глобальные guards (JwtAuthGuard, RolesGuard), декораторы (@Public, @Roles, @CurrentUser)
- **Users** — CRUD пользователей, роли admin/customs, серверная пагинация/фильтрация
- **TelegramUsers** — регистрация Telegram-пользователей, детальный просмотр по UUID
- **Documents** — загрузка (Telegram + админка), AI-парсинг, обработка через BullMQ, переобработка, скачивание Excel
- **AiParser** — AI-парсинг таблиц (Claude): структура, валюта, перевод, извлечение. Retry + валидация
- **Classifier** — классификация товаров через TKS API
- **Verification** — верификация кодов ТН ВЭД через Claude
- **DutyInterpreter** — AI-интерпретация правил расчёта пошлин (Claude)
- **Calculator** — расчёт пошлин, НДС, акцизов, комиссии за доставку
- **CalculationConfig** — конфигурируемая формула комиссии
- **CalculationLogs** — аудит-лог расчётов
- **Currency** — курсы валют ЦБ РФ, конвертация в RUB
- **TnVed** — справочник кодов ТН ВЭД
- **Tks** — shared-модуль TksApiClient
- **Common** — PaginationQueryDto, PaginatedResponse (shared пагинация)

### Entities

- `User` — пользователи с ролями (admin/customs)
- `TnVedCode` — коды ТН ВЭД
- `RefreshToken` — refresh-токены
- `TelegramUser` — Telegram-пользователи
- `Document` — документы (parsedData, resultData, status, currency)
- `CalculationLog` — аудит-логи расчётов (связан с Document)
- `CalculationConfig` — формула комиссии за доставку

### Миграции и seed

Миграции применяются автоматически при старте API (`migrationsRun: true`).
Seed выполняется автоматически (`SeedService`, `OnApplicationBootstrap`).

```bash
cd apps/api

pnpm migration:generate src/database/migrations/Name  # новая миграция
pnpm migration:run                                      # ручной запуск миграций
pnpm seed                                               # ручной seed
```

Seed создаёт: `admin@directport.ru` / `admin123` + 10 образцов кодов ТН ВЭД

## Admin Web

- Страница логина (`/login`)
- Дашборд: статистика, последние документы
- Пользователи: список с пагинацией/фильтром по роли, создание, редактирование, удаление
- Документы: список с пагинацией/фильтром по статусу, загрузка файлов, детали, скачивание Excel, переобработка
- Telegram-пользователи: список с пагинацией, детальная страница с документами
- Логи расчётов: таблица с пагинацией, ссылки на документы
- Справочник ТН ВЭД: поиск кодов
- Настройки: формула комиссии за доставку
- Shared: InfoCard, table-styles, format, хуки с серверной пагинацией
- API-клиент (`src/lib/api.ts`) с автообновлением JWT-токенов

## Telegram-бот

- Команды: `/start`, `/help`
- Загрузка .xlsx/.csv → AI-парсинг через API
- Уведомления о результатах обработки → отправка Excel
- API-клиент для связи с backend (`X-Internal-Key`)

## Переменные окружения

Каждое приложение имеет свой `.env.example` в своей директории:

| Переменная            | Описание                          | По умолчанию                    |
|-----------------------|-----------------------------------|---------------------------------|
| PORT                  | Порт API                          | 3001                            |
| DATABASE_URL          | PostgreSQL connection string      | postgresql://...localhost:5434   |
| REDIS_URL             | Redis connection string           | redis://localhost:6380           |
| JWT_SECRET            | Секрет для JWT                    | change-me-to-a-random-secret    |
| JWT_ACCESS_EXPIRATION | Время жизни access token          | 15m                             |
| API_INTERNAL_KEY      | Ключ для service-to-service (бот) | change-me-to-a-random-key       |
| TKS_API_KEY           | Ключ для api1.tks.ru              | —                               |
| ANTHROPIC_API_KEY     | Ключ Anthropic (парсинг, верификация, пошлины) | —                  |
| TELEGRAM_BOT_TOKEN    | Токен Telegram-бота               | —                               |
| NEXT_PUBLIC_API_URL   | URL API для админки               | http://localhost:3001/api       |

## Структура проекта

```
direct-port/
├── apps/
│   ├── api/              # NestJS backend (порт 3001)
│   │   └── src/
│   │       ├── auth/           # JWT, guards, strategies, decorators
│   │       ├── users/          # CRUD пользователей
│   │       ├── telegram-users/ # Telegram-пользователи
│   │       ├── documents/      # загрузка, обработка, экспорт документов
│   │       ├── ai-parser/      # AI-парсинг таблиц (Claude)
│   │       ├── classifier/     # классификация товаров (TKS API)
│   │       ├── verification/   # верификация кодов (Claude)
│   │       ├── duty-interpreter/ # интерпретация пошлин (Claude)
│   │       ├── calculator/     # расчёт пошлин и налогов
│   │       ├── calculation-config/ # формула комиссии
│   │       ├── calculation-logs/   # аудит-логи расчётов
│   │       ├── currency/       # курсы валют ЦБ РФ
│   │       ├── tn-ved/         # справочник ТН ВЭД
│   │       ├── common/         # shared DTOs, interfaces (пагинация)
│   │       └── database/       # TypeORM, entities, migrations, seeds
│   ├── admin-web/        # Next.js админка (порт 3000)
│   │   └── src/
│   │       ├── app/        # pages (login, dashboard, documents, users, ...)
│   │       ├── components/ # shared UI (InfoCard)
│   │       ├── hooks/      # useAuth, useUsers, useDocuments, ...
│   │       └── lib/        # api client, types, format, table-styles
│   └── tg-bot/           # Telegram бот (порт 3002)
│       └── src/
│           ├── bot/        # grammY, handlers (start, help, file-upload)
│           └── api-client/ # HTTP-клиент к API
├── libs/
│   └── tks-api/          # клиент API таможенного справочника
├── docs/                 # документация
├── examples/             # примеры входных файлов
├── docker-compose.yml    # Postgres + Redis
└── ecosystem.config.js   # PM2 конфигурация
```
