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
| Redis    | 6379 | —                          |

```bash
pnpm infra          # запуск
pnpm infra:stop     # остановка
pnpm infra:logs     # логи
```

## Приложения

PM2 управляет dev-процессами:

| Приложение | Порт | Путь           |
|------------|------|----------------|
| API        | 3001 | apps/api       |
| Admin Web  | 3000 | apps/admin-web |
| TG Bot     | 3002 | apps/tg-bot    |

```bash
pnpm dev            # запуск через PM2
pnpm dev:stop       # остановка
pnpm dev:logs       # логи
pnpm dev:status     # статус процессов
```

## API

```bash
cd apps/api

pnpm migration:generate src/database/migrations/Name  # новая миграция
pnpm migration:run                                      # применить миграции
pnpm seed                                               # seed admin + ТН ВЭД
```

Seed создаёт: `admin@directport.ru` / `admin123`

## Переменные окружения

Скопировать `.env.example` в `.env` (или создать `.env` в `apps/api`):

```bash
cp .env.example apps/api/.env
```

## Структура проекта

```
direct-port/
├── apps/
│   ├── api/          # NestJS backend (порт 3001)
│   ├── admin-web/    # Next.js админка (порт 3000)
│   └── tg-bot/       # Telegram бот (порт 3002)
├── docs/             # документация
├── docker-compose.yml
└── ecosystem.config.js
```
