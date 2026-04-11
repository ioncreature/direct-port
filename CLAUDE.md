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
- AI: Anthropic Claude (парсинг документов, верификация кодов ТН ВЭД, интерпретация пошлин)
- Node.js 24+

## Быстрый старт

```bash
pnpm install          # установка зависимостей
pnpm infra            # postgres (порт 5434) + redis (порт 6380) через docker compose
pnpm dev              # миграции + seed + запуск всех приложений через PM2
```

Seed создаёт: admin user (admin@directport.ru / admin123) + 10 образцов кодов ТН ВЭД.

Каждое приложение читает `.env` из своей директории. Шаблоны: `apps/*/.env.example`.

Система работает и без бота — API + админка функционируют самостоятельно.

## Приложения

### apps/api — REST API

- JWT-авторизация (access + refresh tokens)
- Роли: admin, customs
- Глобальные guards: JwtAuthGuard (пропускает X-Internal-Key), RolesGuard
- Модули:
  - Auth, Users — авторизация и управление пользователями
  - TnVed — поиск кодов ТН ВЭД в БД
  - TelegramUsers — регистрация пользователей Telegram, детальный просмотр по UUID
  - Documents — загрузка (Telegram + админка), обработка, переобработка, скачивание
  - AiParser — AI-парсинг таблиц (Claude): определение валюты, перевод, извлечение данных. Retry + валидация
  - Classifier — классификация товаров через TKS API (searchGoodsGrouped)
  - Calculator — расчёт пошлин, НДС, акцизов, комиссии за доставку
  - DutyInterpreter — AI-интерпретация правил расчёта пошлин из справочника ТН ВЭД (Claude)
  - Verification — верификация кодов ТН ВЭД через Claude (опционально)
  - CalculationConfig — конфигурируемая формула комиссии (CRUD)
  - CalculationLogs — аудит-лог расчётов (запись после обработки, просмотр в админке)
  - Currency — курсы валют ЦБ РФ, конвертация в RUB
  - Tks — shared-модуль TksApiClient
- Common: PaginationQueryDto, PaginatedResponse — shared инфраструктура пагинации
- Очереди BullMQ: document-parsing (AI-парсинг), document-processing (классификация/расчёт), document-notifications (уведомления в Telegram)
- Entities: User, TnVedCode, RefreshToken, CalculationLog, TelegramUser, Document, CalculationConfig
- Миграции и seed через TypeORM CLI (tsx)

### apps/admin-web — Админ-панель (Next.js)

- Страница логина, JWT-сессия
- Дашборд: статистика, последние документы
- Пользователи: список с пагинацией/фильтром по роли/сортировкой, создание, редактирование, удаление
- Документы: список с пагинацией/фильтром по статусу/сортировкой, загрузка .xlsx/.csv, детали с таблицей результатов, скачивание Excel, переобработка failed-документов, ручная проверка requires_review (редактирование parsedData, подтверждение/отклонение)
- Telegram-пользователи: список с пагинацией/сортировкой, детальная страница с документами пользователя
- Логи расчётов: таблица с пагинацией/сортировкой, ссылки на документы
- Справочник ТН ВЭД: поиск кодов с debounce
- Настройки: формула комиссии за доставку (pricePercent, weightRate, fixedFee)
- Shared: InfoCard, table-styles, format (fmt), хуки с серверной пагинацией
- API-клиент с автообновлением токенов

### apps/tg-bot — Telegram-бот

- grammY, команды /start, /help
- Загрузка .xlsx/.csv → отправка файла в API (POST /documents/upload), мгновенный ответ (парсинг асинхронный через BullMQ)
- Состояние диалога в Redis (ConversationStateService, TTL 1 час)
- Получение уведомлений через BullMQ (document-notifications) → отправка Excel в Telegram
- API-клиент для связи с backend (X-Internal-Key)

### libs/tks-api — Клиент API таможенного справочника (api1.tks.ru)

- Поиск товаров: searchGoods, searchGoodsGrouped, searchGoodsByCode
- Справочник ТН ВЭД: getTnvedCode (ставки IMP/NDS/AKC), getTnvedCodeList
- Справочники: страны (OKSMT), экономические зоны (EK AR)
- In-memory кэш: TTL 1 час, макс. 1000 записей, дедупликация запросов

## Pipeline обработки документа

```
Загрузка файла (Telegram-бот: POST /documents/upload, Админка: POST /documents/upload-admin)
→ Сохранение fileBuffer в БД, status=PARSING → BullMQ: document-parsing (ответ за 1-2с)
→ [Воркер] AiParser (Claude): определение структуры, валюты, перевод, извлечение данных
→ Валидация (детерминистическая + AI), retry до 2 попыток
→ Если confident → status=PENDING → BullMQ: document-processing
→ Если не confident → status=REQUIRES_REVIEW → ручная проверка в админке (PATCH :id/review + POST :id/reprocess или POST :id/reject)
→ [Воркер] Classifier (TKS API: searchGoodsGrouped → getTnvedCode)
→ Verification (Claude: верификация кодов, опционально)
→ DutyInterpreter (Claude: интерпретация правил расчёта пошлин)
→ Calculator (пошлина + НДС + акциз + комиссия, конвертация валют → RUB)
→ resultData + CalculationLog (аудит) → BullMQ: document-notifications
→ Excel-экспорт → отправка пользователю (только для Telegram-загрузок)
```

BullMQ очереди: `document-parsing` → `document-processing` → `document-notifications`

Переобработка: `POST /documents/:id/reprocess` — если есть parsedData → document-processing, если нет (но есть fileBuffer) → document-parsing.

### Форматы данных в pipeline

**Входной файл** (.xlsx или .csv с автодетектом разделителя `,` `;` `\t`):

- 4 обязательные колонки: описание, цена, вес, количество (определяются AI-парсером автоматически)
- Наименования могут быть на любом языке (часто — китайский); переводятся на русский AI-парсером
- Цены могут быть в любой валюте (не только USD) — валюта определяется для всего документа
- Пример: `examples/in_1.xlsx` (китайские наименования, цены в юанях)

**parsedData** (JSONB в Document, массив `ProductRow[]`):

```typescript
interface ProductRow {
  description: string; // наименование товара (переведённое на русский)
  quantity: number;
  price: number; // цена в исходной валюте документа
  weight: number; // вес в кг
}
```

**После классификации** (`ClassifiedProduct`):

- Добавляются: tnVedCode, tnVedDescription, dutyRate, dutySign, dutyMin, dutyMinUnit, vatRate, exciseRate, matchConfidence, matched
- Батчи по 5 товаров параллельно

**После верификации** (`VerifiedProduct`, опционально):

- Добавляются: verified, suggestedCode, verificationComment
- Батчи по 10, Claude claude-sonnet-4-20250514

**После расчёта** (`CalculatedProduct`):

- Добавляются: totalPrice, dutyAmount, vatAmount, exciseAmount, logisticsCommission, totalCost, verificationStatus ('exact'|'review')
- Все суммы рассчитываются в исходной валюте и конвертируются в RUB по актуальному курсу

**resultData** (JSONB в Document): массив `CalculatedProduct[]`

**Выходной Excel** (лист "Результат", 14+ колонок):

- Исходные данные: наименование, количество, цена, вес
- Классификация: код ТН ВЭД, описание ТН ВЭД, ставки пошлины/НДС
- Расчёты: сумма товара, пошлина, НДС, акциз, комиссия доставки, итого
- Все стоимости указываются как в исходной валюте, так и в рублях
- Статус проверки: зелёный (точное) / жёлтый (ручная проверка)
- Стилизация: синий заголовок, автофильтр, заморозка строки заголовка

### Формула расчёта

```
totalPrice     = price × quantity
dutyAmount     = totalPrice × (dutyRate / 100)
                 // для комбинированных ставок (dutySign='>'): max(dutyAmount, dutyMin × weight × quantity)
exciseAmount   = totalPrice × (exciseRate / 100)
vatAmount      = (totalPrice + dutyAmount + exciseAmount) × (vatRate / 100)
logisticsComm  = totalPrice × (pricePercent / 100) + weight × quantity × weightRate + fixedFee
totalCost      = totalPrice + dutyAmount + vatAmount + exciseAmount + logisticsCommission
```

verificationStatus = matched AND matchConfidence >= 0.7 ? 'exact' : 'review'

## Команды

```bash
pnpm install        # установка зависимостей
pnpm dev            # миграции + seed + запуск всех приложений через PM2
pnpm dev:stop       # остановка
pnpm dev:logs       # логи PM2
pnpm dev:status     # статус процессов
pnpm infra          # postgres (5434) + redis (6380) через docker compose
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

Каждое приложение имеет свой `.env` (шаблоны в `.env.example`).

**apps/api/.env:**

- `PORT` — порт API (по умолчанию 3001)
- `DATABASE_URL` — PostgreSQL (по умолчанию postgresql://directport:directport@localhost:5434/directport)
- `REDIS_URL` — Redis (по умолчанию redis://localhost:6380)
- `JWT_SECRET`, `JWT_ACCESS_EXPIRATION` — JWT-настройки
- `API_INTERNAL_KEY` — ключ для service-to-service вызовов (бот → API)
- `TKS_API_BASE_URL` — базовый URL TKS API (по умолчанию https://api1.tks.ru, можно указать прокси)
- `TKS_TNVED_API_KEY` — ключ для TNVED API на api1.tks.ru (справочник ТН ВЭД)
- `TKS_GOODS_API_KEY` — ключ для GOODS API на api1.tks.ru (поиск товаров)
- `ANTHROPIC_API_KEY` — ключ Anthropic для верификации Claude (опционально)

**apps/tg-bot/.env:**

- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота
- `API_BASE_URL` — URL API (по умолчанию http://localhost:3001/api)
- `API_INTERNAL_KEY` — ключ для доступа к API
- `REDIS_URL` — Redis (по умолчанию redis://localhost:6380)

**apps/admin-web/.env:**

- `NEXT_PUBLIC_API_URL` — URL API (по умолчанию http://localhost:3001/api)

## Инфраструктура

Docker compose (порты выбраны чтобы не конфликтовать с системными):

- PostgreSQL: 5434 → 5432 (user: directport, password: directport, db: directport)
- Redis: 6380 → 6379

## Известные задачи и баги

- [x] Конвертация валют: CurrencyService (курсы ЦБ РФ, кэш 1 час), двойное отображение в Excel
- [x] Упрощение запуска: миграции (migrationsRun: true) + seed (SeedService OnApplicationBootstrap) автоматически при старте API
- [x] Загрузка документов через админку: POST /documents/upload-admin с JWT-авторизацией
- [x] Пагинация, фильтры, сортировка: серверная пагинация для documents, users, telegram-users, calculation-logs
- [x] Логи расчётов: CalculationLogsModule, аудит после обработки, страница в админке
- [x] Повторная обработка: POST /documents/:id/reprocess для failed/requires_review
- [x] Детальная страница Telegram-пользователя: информация + документы пользователя
- [x] AI-интерпретация пошлин: DutyInterpreterService (Claude) для расчёта комбинированных ставок
- [x] Перенос AI-парсинга в BullMQ: очередь document-parsing, воркер DocumentsParsingProcessor, fileBuffer в BYTEA, статус PARSING
- [x] Интерфейс ручной проверки: PATCH :id/review (редактирование parsedData), POST :id/reject (отклонение с причиной), inline-таблица на странице деталей документа

## Три точки применения AI (Claude)

1. **Парсинг документов** (AiParserService) — анализ структуры таблицы, определение валюты, перевод наименований, извлечение данных. Детерминистическая + AI валидация, retry до 2 попыток
2. **Верификация кодов ТН ВЭД** (VerificationService) — проверка и уточнение кодов, предложенных классификатором TKS API
3. **Интерпретация правил расчёта пошлин** (DutyInterpreterService) — анализ текстовых правил из справочника ТН ВЭД: комбинированные ставки, специфические пошлины (EUR/кг, EUR/л), акцизы. Claude извлекает параметры расчёта из описания кода

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
- Очереди: BullMQ через Redis, обе стороны (api producer, tg-bot consumer) подключены к одному Redis
