# DirectPort

Сервис для импорта товаров в Россию: оформление деклараций, расчёт пошлин и налогов.

## Стек

- Монорепозиторий: pnpm workspaces
- Backend: NestJS (apps/api, порт 3001)
- Админка: Next.js (apps/admin-web, порт 3000)
- БД: PostgreSQL 17
- Кэш: Redis 7
- Node.js 24+

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск api + web через PM2
pnpm dev:stop       # остановка
pnpm infra          # postgres + redis через docker compose
pnpm infra:stop     # остановка инфры
pnpm build          # сборка всех приложений
pnpm lint           # линтинг
pnpm test           # тесты
```

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
