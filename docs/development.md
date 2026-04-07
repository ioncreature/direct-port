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

# Запустить миграции и seed
cd apps/api && pnpm migration:run && pnpm seed && cd ../..

# Запустить приложения
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

- **Auth** — JWT-авторизация (access + refresh tokens), стратегия jwt, глобальные guards (JwtAuthGuard, RolesGuard), декораторы (@Public, @Roles, @CurrentUser)
- **Users** — CRUD пользователей, роли admin/customs
- **TN VED** — справочник кодов ТН ВЭД
- **Database** — TypeORM, entities, миграции, seed

### Entities

- `User` — пользователи с ролями
- `TnVedCode` — коды ТН ВЭД
- `RefreshToken` — refresh-токены
- `CalculationLog` — логи расчётов пошлин

### Миграции и seed

```bash
cd apps/api

pnpm migration:generate src/database/migrations/Name  # новая миграция
pnpm migration:run                                      # применить миграции
pnpm seed                                               # seed admin + ТН ВЭД
```

Seed создаёт: `admin@directport.ru` / `admin123`

## Admin Web

- Страница логина (`/login`)
- Dashboard с управлением пользователями (`/(dashboard)/users`)
- AuthProvider + хуки `useAuth`, `useUsers`
- API-клиент (`src/lib/api.ts`)

## Telegram-бот

- Команды: `/start`, `/help`
- Обработка Excel-документов с товарами
- Классификатор товаров → коды ТН ВЭД
- Калькулятор пошлин и налогов
- API-клиент для связи с backend (заголовок `X-Internal-Key`)

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
| TELEGRAM_BOT_TOKEN    | Токен Telegram-бота               | —                               |

## Структура проекта

```
direct-port/
├── apps/
│   ├── api/              # NestJS backend (порт 3001)
│   │   └── src/
│   │       ├── auth/     # JWT, guards, strategies, decorators
│   │       ├── users/    # CRUD пользователей
│   │       ├── tn-ved/   # справочник ТН ВЭД
│   │       └── database/ # TypeORM, entities, migrations, seeds
│   ├── admin-web/        # Next.js админка (порт 3000)
│   │   └── src/
│   │       ├── app/      # pages (login, dashboard, users)
│   │       ├── components/
│   │       ├── hooks/    # useAuth, useUsers
│   │       └── lib/      # api client, types
│   └── tg-bot/           # Telegram бот (порт 3002)
│       └── src/
│           ├── bot/      # grammY, handlers (start, help, document)
│           ├── excel/    # парсинг Excel
│           ├── classifier/ # классификация товаров
│           ├── calculator/ # расчёт пошлин
│           └── api-client/ # HTTP-клиент к API
├── docs/                 # документация
├── docker-compose.yml    # Postgres + Redis
└── ecosystem.config.js   # PM2 конфигурация
```
