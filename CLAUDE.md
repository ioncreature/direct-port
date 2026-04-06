# DirectPort

Сервис для импорта товаров в Россию: оформление деклараций, расчёт пошлин и налогов.

## Стек

- Монорепозиторий: pnpm 10+ workspaces
- Backend: NestJS + TypeORM (apps/api, порт 3001)
- Админка: Next.js (apps/admin-web, порт 3000)
- Telegram-бот: NestJS + grammY (apps/tg-bot, порт 3002)
- БД: PostgreSQL 17
- Кэш: Redis 7
- Node.js 24+

## Приложения

### apps/api — REST API
- JWT-авторизация (access + refresh tokens)
- Роли: admin, customs
- Глобальные guards: JwtAuthGuard, RolesGuard
- Модули: Auth, Users, TN VED, Database
- Entities: User, TnVedCode, RefreshToken, CalculationLog
- Миграции и seed через TypeORM CLI (tsx)

### apps/admin-web — Админ-панель (Next.js)
- Страница логина, JWT-сессия
- Dashboard: управление пользователями
- AuthProvider, хуки useAuth / useUsers
- API-клиент для связи с backend

### apps/tg-bot — Telegram-бот
- grammY, команды /start, /help
- Обработка Excel-документов (exceljs)
- Классификатор товаров по ТН ВЭД
- Калькулятор пошлин и налогов
- API-клиент для связи с backend (X-Internal-Key)

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # запуск всех приложений через PM2
pnpm dev:stop       # остановка
pnpm dev:logs       # логи PM2
pnpm dev:status     # статус процессов
pnpm infra          # postgres + redis через docker compose
pnpm infra:stop     # остановка инфры
pnpm infra:logs     # логи инфраструктуры
pnpm build          # сборка всех приложений
pnpm lint           # линтинг всех приложений
pnpm test           # тесты всех приложений

# API (из apps/api)
pnpm migration:generate src/database/migrations/Name
pnpm migration:run
pnpm seed           # admin@directport.ru / admin123
```

## Переменные окружения

Копировать `.env.example` → `apps/api/.env`:
- `DATABASE_URL` — PostgreSQL (по умолчанию порт 5434)
- `REDIS_URL` — Redis
- `JWT_SECRET`, `JWT_ACCESS_EXPIRATION` — JWT-настройки
- `API_INTERNAL_KEY` — ключ для service-to-service вызовов (бот → API)
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
