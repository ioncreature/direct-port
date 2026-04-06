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

# Запустить приложения
pnpm dev
```

## Инфраструктура

Docker Compose поднимает:

| Сервис   | Порт | Credentials                |
|----------|------|----------------------------|
| Postgres | 5432 | directport / directport    |
| Redis    | 6379 | —                          |

```bash
pnpm infra          # запуск
pnpm infra:stop     # остановка
pnpm infra:logs     # логи
```

## Приложения

PM2 управляет dev-процессами:

| Приложение | Порт | Путь       |
|------------|------|------------|
| API        | 3001 | apps/api       |
| Admin Web  | 3000 | apps/admin-web |

```bash
pnpm dev            # запуск через PM2
pnpm dev:stop       # остановка
pnpm dev:logs       # логи
pnpm dev:status     # статус процессов
```

## Переменные окружения

Скопировать `.env.example` в `.env` и заполнить при необходимости:

```bash
cp .env.example .env
```

## Структура проекта

```
direct-port/
├── apps/
│   ├── api/          # NestJS backend (порт 3001)
│   └── admin-web/    # Next.js админка (порт 3000)
├── docs/             # документация
├── docker-compose.yml
└── ecosystem.config.js
```
