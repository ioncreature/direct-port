# DirectPort

Сервис для импорта товаров в Россию: оформление деклараций, расчёт пошлин и налогов.

## Стек

- Монорепозиторий: pnpm workspaces
- Backend: NestJS + TypeORM (apps/api, порт 3001)
- Админка: Next.js (apps/admin-web, порт 3000)
- Telegram-бот: NestJS + grammY (apps/tg-bot, порт 3002)
- БД: PostgreSQL 17
- Кэш: Redis 7
- Node.js 24+

## Приложения

- `apps/api` — REST API, JWT-авторизация, роли admin/customs, ТН ВЭД
- `apps/admin-web` — админка, управление пользователями
- `apps/tg-bot` — Telegram бот для обработки Excel-файлов с товарами

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск всех приложений через PM2
pnpm dev:stop       # остановка
pnpm infra          # postgres + redis через docker compose
pnpm infra:stop     # остановка инфры
pnpm build          # сборка всех приложений

# API (из apps/api)
pnpm migration:generate src/database/migrations/Name
pnpm migration:run
pnpm seed           # admin@directport.ru / admin123
```

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
