# DirectPort

Сервис для импорта товаров в Россию: оформление деклараций, расчёт пошлин и налогов.

## Стек

- Монорепозиторий: pnpm 10+ workspaces
- Backend: NestJS + TypeORM (apps/api, порт 3001)
- Админка: Next.js (apps/admin-web, порт 3000)
- Telegram-бот: NestJS + grammY (apps/tg-bot, порт 3002)
- Библиотеки: libs/tks-api (клиент API таможенного справочника)
- БД: PostgreSQL 17
- Очереди: BullMQ + Redis 7
- AI: Anthropic Claude (верификация кодов ТН ВЭД)
- Node.js 24+

## Приложения

### apps/api — REST API
- JWT-авторизация (access + refresh tokens)
- Роли: admin, customs
- Глобальные guards: JwtAuthGuard (пропускает X-Internal-Key), RolesGuard
- Модули:
  - Auth, Users — авторизация и управление пользователями
  - TnVed — поиск кодов ТН ВЭД в БД
  - TelegramUsers — регистрация пользователей Telegram
  - Documents — загрузка, обработка, скачивание документов
  - Classifier — классификация товаров через TKS API (searchGoodsGrouped)
  - Calculator — расчёт пошлин, НДС, акцизов, комиссии за доставку
  - Verification — верификация кодов ТН ВЭД через Claude (опционально)
  - CalculationConfig — конфигурируемая формула комиссии (CRUD)
  - Tks — shared-модуль TksApiClient
- Entities: User, TnVedCode, RefreshToken, CalculationLog, TelegramUser, Document, CalculationConfig
- Миграции и seed через TypeORM CLI (tsx)

### apps/admin-web — Админ-панель (Next.js)
- Страница логина, JWT-сессия
- Пользователи: список, создание
- Документы: список, скачивание обработанных Excel
- Настройки: формула комиссии за доставку (pricePercent, weightRate, fixedFee)
- AuthProvider, хуки useAuth / useUsers / useDocuments / useCalculationConfig
- API-клиент с автообновлением токенов

### apps/tg-bot — Telegram-бот
- grammY, команды /start, /help
- Загрузка .xlsx/.csv, выбор колонок inline-кнопками (описание → цена → вес → количество)
- Состояние диалога в Redis (ConversationStateService, TTL 1 час)
- Отправка parsed data в API → BullMQ очередь
- Получение уведомлений через BullMQ (document-notifications) → отправка Excel в Telegram
- API-клиент для связи с backend (X-Internal-Key)

### libs/tks-api — Клиент API таможенного справочника (api1.tks.ru)
- Поиск товаров: searchGoods, searchGoodsGrouped, searchGoodsByCode
- Справочник ТН ВЭД: getTnvedCode (ставки IMP/NDS/AKC), getTnvedCodeList
- Справочники: страны (OKSMT), экономические зоны (EK AR)
- In-memory кэш: TTL 1 час, макс. 1000 записей, дедупликация запросов

## Pipeline обработки документа

```
Telegram → загрузка файла → выбор колонок → parse
→ POST /documents (parsedData) → BullMQ: document-processing
→ Classifier (TKS API: searchGoodsGrouped → getTnvedCode)
→ Verification (Claude: верификация кодов, опционально)
→ Calculator (пошлина + НДС + акциз + комиссия)
→ resultData → BullMQ: document-notifications
→ Бот скачивает Excel → отправляет в Telegram
```

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

В `apps/api/.env`:
- `DATABASE_URL` — PostgreSQL (по умолчанию порт 5434)
- `REDIS_URL` — Redis
- `JWT_SECRET`, `JWT_ACCESS_EXPIRATION` — JWT-настройки
- `API_INTERNAL_KEY` — ключ для service-to-service вызовов (бот → API)
- `TKS_API_KEY` — ключ для api1.tks.ru (таможенный справочник)
- `ANTHROPIC_API_KEY` — ключ Anthropic для верификации Claude (опционально)

В `apps/tg-bot/.env`:
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота
- `API_BASE_URL` — URL API (по умолчанию http://localhost:3001/api)
- `API_INTERNAL_KEY` — ключ для доступа к API
- `REDIS_URL` — Redis (для состояния диалога и BullMQ)

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
- Очереди: BullMQ через Redis, обе стороны (api producer, tg-bot consumer) подключены к одному Redis
