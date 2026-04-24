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
- Модули верхнего уровня (app.module.ts): Auth, Users, TnVed, TelegramUsers, Documents, CalculationConfig, AiConfig, Countries
  - Auth, Users — авторизация и управление пользователями
  - TnVed — справочник ТН ВЭД: поиск по TKS API (searchGoodsGrouped + getTnvedCode), перевод запросов через Claude, обогащение ставками
  - TelegramUsers — регистрация пользователей Telegram, детальный просмотр по UUID, PATCH :telegramId/language
  - Documents — загрузка (Telegram + админка), обработка, переобработка, скачивание, token-stats. Зонтичный модуль: агрегирует внутри AiParser/Classifier/Calculator/DutyInterpreter/Currency/CalculationLogs/Tks, они не импортируются на верхнем уровне
  - CalculationConfig — настройки формулы комиссии, флага отправки Excel, порога уверенности классификатора (CRUD)
  - AiConfig — CRUD для выбора моделей Claude (opus/sonnet/haiku) для 4 сценариев AI. См. `docs/AI_CONFIG.md`
  - Countries — справочник стран (OKSMT), используется для страны происхождения товара
- Вложенные модули (внутри DocumentsModule):
  - AiParser — AI-парсинг таблиц (Claude): определение валюты, перевод, извлечение данных, автодетект страны происхождения. Retry + валидация
  - Classifier — классификация+верификация ТН ВЭД: TKS search (батчи по 5) → Claude classify+verify (батчи по 10) → getTnvedCode
  - Calculator — расчёт пошлин, НДС, акцизов, комиссии за доставку
  - DutyInterpreter — AI-интерпретация правил расчёта пошлин из справочника ТН ВЭД (Claude)
  - CalculationLogs — аудит-лог расчётов (запись после обработки, доступ через GET /documents/:id/calculation-history)
  - Currency — курсы валют ЦБ РФ, конвертация в RUB
  - Tks — shared-инфраструктура: TksApiClient + PgTksCacheStore (PostgreSQL-кэш TKS API)
- Common: PaginationQueryDto, PaginatedResponse, ErrorCode (коды ошибок для i18n), ProductNote (messageLocalized), note-translations, token-usage (утилиты для TokenUsageByStage) — shared инфраструктура
- Очереди BullMQ: document-parsing (AI-парсинг), document-processing (классификация/расчёт), document-notifications (уведомления в Telegram)
- Entities: User, RefreshToken, TnVedCode, TelegramUser (+ language), Document (+ language, countryOfOrigin, tokenUsage), CalculationConfig, CalculationLog, TksCache, AiConfig, AiUsageLog
- Миграции и seed через TypeORM CLI (tsx)
- AI-учёт токенов: `Document.tokenUsage` (JSONB per-stage per-model) + таблица `ai_usage_log` (для translate вне pipeline). Агрегируется через endpoints `/documents/token-stats*`. См. `docs/AI_USAGE_TRACKING.md`

### apps/admin-web — Админ-панель (Next.js)

- Страница логина, JWT-сессия
- Дашборд: статистика, последние документы
- Пользователи: список с пагинацией/фильтром по роли/сортировкой, создание, редактирование, удаление
- Документы: список с пагинацией/фильтром по статусу/сортировкой, загрузка .xlsx/.csv, детали с таблицей результатов, скачивание Excel, переобработка failed-документов, ручная проверка requires_review (редактирование parsedData, подтверждение/отклонение/одобрение), пересчёт с другой страной (POST :id/recalculate), история расчётов
- Вкладка «Диагностика» на странице деталей документа: этапы pipeline (parse/classify/interpret/calculate) с таймингами, ошибками и токенами; список AI-вызовов Claude per stage (модалка с полными request/response по клику); версии parsedData (модалка со snapshot). Ленивая загрузка — данные запрашиваются только при переходе на вкладку
- Telegram-пользователи: список с пагинацией/сортировкой, детальная страница с документами пользователя
- AI-расходы (`/ai-costs`, только ADMIN): сводка токенов и стоимости (Sonnet $3/$15, Haiku $1/$5 за 1M), фильтр по моделям, графики по дням, разбивка по пользователям и последние документы. См. `docs/AI_USAGE_TRACKING.md`
- Справочник ТН ВЭД: поиск по TKS API (текст/код), перевод запросов через Claude (модель настраивается через AiConfig), кликабельные коды, копирование кода, калькулятор пошлин с учётом единиц измерения (кг/л/м²/м³/шт)
- Настройки: формула комиссии (pricePercent, weightRate, fixedFee), порог уверенности классификатора (confidenceThreshold + lowConfidenceAction), отправка Excel пользователю бота (sendResultFile), выбор моделей Claude для 4 AI-сценариев
- Shared: InfoCard, table-styles, format (fmt), хуки с серверной пагинацией
- API-клиент с автообновлением токенов
- Отдельной страницы «Логи расчётов» нет — история доступна на странице деталей документа (вкладка/секция «История расчётов»)

### apps/tg-bot — Telegram-бот

- grammY, команды /start, /help, /language
- Локализация: @grammyjs/i18n + Fluent (.ftl), 3 языка: ru, zh, en
  - Locale файлы: `src/bot/locales/{ru,en,zh}.ftl` (37 ключей в каждом)
  - BotContext = Context & I18nFlavor (типизированный контекст с ctx.t())
  - Автодетект языка из Telegram `language_code`, ручной выбор через /language
  - Язык сохраняется в TelegramUser.language (API) + ConversationState.language (Redis)
  - NotificationHandler (BullMQ worker) использует `i18n.t(locale, key)` вне middleware
- Загрузка .xlsx/.csv → отправка файла в API (POST /documents/upload), мгновенный ответ (парсинг асинхронный через BullMQ)
- Состояние диалога в Redis (ConversationStateService, TTL 1 час)
- Получение уведомлений через BullMQ (document-notifications) → отправка Excel в Telegram
- API-клиент для связи с backend (X-Internal-Key)

### libs/tks-api — Клиент API таможенного справочника (api1.tks.ru)

- Поиск товаров: searchGoods, searchGoodsGrouped, searchGoodsByCode
- Справочник ТН ВЭД: getTnvedCode (ставки IMP/NDS/AKC), getTnvedCodeList
- Справочники: страны (OKSMT), экономические зоны (EK AR)
- In-memory кэш (dev) или PostgreSQL кэш (prod): дедупликация запросов, stale fallback при недоступности API
- TksCacheStore интерфейс: get/set/delete/clear + опциональный getStale (fallback)

## Pipeline обработки документа

```
Загрузка файла (Telegram-бот: POST /documents/upload, Админка: POST /documents/upload-admin)
→ Сохранение fileBuffer в БД, status=PARSING → BullMQ: document-parsing (ответ за 1-2с)
→ [Воркер] AiParser (Claude): определение структуры, валюты, перевод, извлечение данных, автодетект страны происхождения (countryOfOrigin + countryOriginSource: ai_explicit | ai_language | ai_currency | manual | default; дефолт — Китай 156)
→ Валидация (детерминистическая + AI), retry до 2 попыток
→ Если confident → status=PENDING → BullMQ: document-processing → status=PROCESSING
→ Если не confident → status=REQUIRES_REVIEW → ручная проверка в админке (PATCH :id/review + POST :id/reprocess, POST :id/approve или POST :id/reject)
→ [Воркер] Classifier+Verify (TKS API: searchGoodsGrouped → Claude classify+verify → getTnvedCode)
→ Если все коды с низкой уверенностью и lowConfidenceAction='review' → status=CODE_REVIEW_REQUIRED
→ DutyInterpreter (Claude: интерпретация правил расчёта пошлин)
→ При language≠ru: Claude возвращает comment_localized / reasoning_localized для двуязычных замечаний
→ Calculator (пошлина + НДС + акциз + комиссия, конвертация валют → RUB)
→ resultData + CalculationLog (аудит) + tokenUsage → BullMQ: document-notifications
→ status=PROCESSED (или PROCESSED_WITH_ERRORS, если есть проблемные строки)
→ Excel-экспорт → отправка пользователю Telegram (если CalculationConfig.sendResultFile=true)
```

BullMQ очереди: `document-parsing` → `document-processing` → `document-notifications`

Переобработка: `POST /documents/:id/reprocess` — если есть parsedData → document-processing, если нет (но есть fileBuffer) → document-parsing.

Пересчёт: `POST /documents/:id/recalculate` — повторно прогнать классификатор/калькулятор с новыми параметрами (например, явно указать страну происхождения), не парся файл заново.

### Статусы документа (`DocumentStatus`)

| Статус | Когда устанавливается |
|---|---|
| `PARSING` | После загрузки файла, перед обработкой в `document-parsing` |
| `PENDING` | Парсинг успешен, ожидает `document-processing` |
| `PROCESSING` | Воркер processing забрал документ |
| `PROCESSED` | Полный успех — доступна загрузка Excel |
| `PROCESSED_WITH_ERRORS` | Обработан, но часть строк не классифицирована/посчитана |
| `FAILED` | Невосстановимая ошибка в воркере |
| `REQUIRES_REVIEW` | AI-парсер не уверен в распознанных данных — нужна ручная правка parsedData |
| `CODE_REVIEW_REQUIRED` | Классификатор не нашёл уверенного кода ТН ВЭД (зависит от `confidenceThreshold` + `lowConfidenceAction`) |
| `REJECTED` | Оператор отклонил документ через POST :id/reject |

### Endpoints `DocumentsController` (`/documents`)

| Метод | Путь | Роли | Назначение |
|---|---|---|---|
| POST | `/` | — | Создать документ из готового parsedData (служебный) |
| POST | `/upload` | X-Internal-Key | Загрузка из Telegram-бота |
| POST | `/upload-admin` | ADMIN, CUSTOMS | Загрузка из админки |
| GET | `/` | ADMIN, CUSTOMS | Список с пагинацией/фильтром/сортировкой |
| GET | `/status-counts` | ADMIN, CUSTOMS | Счётчики по статусам (для бейджей в UI) |
| GET | `/token-stats` | ADMIN | Сводка AI-токенов (today/week/month/total + by user + recent) |
| GET | `/token-stats/monthly` | ADMIN | Только месячные итоги |
| GET | `/token-stats/daily` | ADMIN | По дням (`?days=30`, max 90, опц. `?model=`) |
| PATCH | `/:id/review` | ADMIN, CUSTOMS | Сохранить отредактированный parsedData |
| POST | `/:id/reject` | ADMIN, CUSTOMS | Отклонить документ с причиной |
| POST | `/:id/approve` | ADMIN, CUSTOMS | Одобрить REQUIRES_REVIEW без правок и запустить processing |
| POST | `/:id/reprocess` | ADMIN, CUSTOMS | Перезапустить с подходящего этапа |
| POST | `/:id/recalculate` | ADMIN, CUSTOMS | Перезапустить classify+calc с новыми параметрами |
| GET | `/:id` | ADMIN, CUSTOMS | Детали документа |
| GET | `/:id/calculation-history` | ADMIN, CUSTOMS | Все CalculationLog по документу |
| GET | `/:id/stage-runs` | ADMIN, CUSTOMS | Этапы pipeline + lite-список AI-вызовов (для вкладки «Диагностика») |
| GET | `/:id/ai-calls/:callId` | ADMIN, CUSTOMS | Полный request/response одного вызова Claude |
| GET | `/:id/versions` | ADMIN, CUSTOMS | Список версий parsedData (без snapshot) |
| GET | `/:id/versions/:version` | ADMIN, CUSTOMS | Snapshot конкретной версии parsedData |
| GET | `/:id/download` | ADMIN, CUSTOMS | Скачать Excel (только PROCESSED) |
| GET | `/:id/download-internal` | X-Internal-Key | То же для бота |

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
  weight: number; // вес за единицу в кг
}
```

**После классификации+верификации** (`ClassifiedProduct` / `VerifiedProduct` — алиасы):

- Добавляются: tnVedCode, tnVedDescription, dutyRate, dutySign, dutyMin, dutyMinUnit, vatRate, exciseRate, matchConfidence, matched, verified, suggestedCode, verificationComment
- TKS search батчи по 5, Claude classify+verify батчи по 10
- При language≠ru: Claude возвращает comment_localized → попадает в ProductNote.messageLocalized

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
- При document.language≠ru: доп. колонка «Notes (translated)» / «备注（翻译）» с локализованными замечаниями

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
- [x] Логи расчётов: CalculationLogsModule, аудит после обработки, история на странице деталей документа (GET /documents/:id/calculation-history)
- [x] Повторная обработка: POST /documents/:id/reprocess для failed/requires_review
- [x] Детальная страница Telegram-пользователя: информация + документы пользователя
- [x] AI-интерпретация пошлин: DutyInterpreterService (Claude) для расчёта комбинированных ставок
- [x] Перенос AI-парсинга в BullMQ: очередь document-parsing, воркер DocumentsParsingProcessor, fileBuffer в BYTEA, статус PARSING
- [x] Интерфейс ручной проверки: PATCH :id/review (редактирование parsedData), POST :id/reject (отклонение с причиной), inline-таблица на странице деталей документа

## Кэширование TKS API

Результаты TKS API кэшируются в PostgreSQL (таблица `tks_cache`, entity `TksCache`). Реализация: `PgTksCacheStore` (apps/api/src/tks/pg-tks-cache.store.ts).

**Категории и TTL** (определяются по паттерну ключа):

- `goods` — результаты searchGoodsGrouped, TTL 120 дней (`TKS_CACHE_TTL_GOODS_MS`)
- `tnved` — коды getTnvedCode, TTL 7 дней (`TKS_CACHE_TTL_TNVED_MS`)
- `reference` — справочники (страны, эк. зоны), TTL 7 дней (`TKS_CACHE_TTL_REFERENCE_MS`)
- `other` — прочее, TTL 24 часа (`TKS_CACHE_TTL_OTHER_MS`)

**Stale fallback:** При недоступности TKS API клиент вызывает `getStale()` — возвращает данные из БД независимо от возраста. Оптимизация: `get()` сохраняет stale-значение в памяти, `getStale()` использует его без повторного запроса к БД.

**Очистка:** Вероятностная (1% при каждом `set()`), удаляет записи старше 3× максимального TTL (для goods это 360 дней).

**Свежесть:** Определяется динамически из `fetched_at + categoryTtl`, без колонки `expires_at`. Позволяет менять TTL без обновления строк.

## Четыре точки применения AI (Claude)

Конкретная модель Claude для каждого сценария настраивается в БД (таблица `ai_config`) через `PUT /ai-config` (только ADMIN). По умолчанию: parser=sonnet, classifier=sonnet, interpreter=sonnet, queryFormulation=haiku. Подробнее — `docs/AI_CONFIG.md`.

1. **Парсинг документов** (AiParserService, поле `parserModel`) — анализ структуры таблицы, определение валюты, перевод наименований, извлечение данных, автодетект страны происхождения. Детерминистическая + AI валидация, retry до 2 попыток
2. **Классификация+верификация кодов ТН ВЭД** (ClassifierService, поле `classifierModel`) — объединённый classify+verify в одном запросе Claude. При language≠ru промпт запрашивает comment_localized для двуязычных замечаний
3. **Интерпретация правил расчёта пошлин** (DutyInterpreterService, поле `interpreterModel`) — анализ текстовых правил из справочника ТН ВЭД: комбинированные ставки, специфические пошлины (EUR/кг, EUR/л), акцизы. При language≠ru промпт запрашивает reasoning_localized
4. **Перевод поисковых запросов** (TnVedService, поле `queryFormulationModel`) — перевод запросов в справочнике ТН ВЭД с английского/китайского на русский для поиска в TKS API. max_tokens: 100, timeout: 10с. Graceful degradation: без API-ключа поиск работает без перевода. ⚠️ В коде модель сейчас захардкожена `claude-sonnet-4-6` (`tn-ved.service.ts:257`), хотя `AiConfigService.getQueryFormulationModel()` уже существует и должен использоваться — расхождение, требующее правки

Все вызовы Claude учитываются: токены классификатора/интерпретатора/парсера записываются в `Document.tokenUsage` (per-stage per-model), вызовы перевода — в таблицу `ai_usage_log`. См. `docs/AI_USAGE_TRACKING.md`.

## Локализация бота (i18n)

Локализован только Telegram-бот. Админка и REST API остаются на русском. Изменения в API — исключительно инфраструктурные (хранение языка, коды ошибок, локализованные поля в notes) и не меняют поведение для админки.

- Поддерживаемые языки: ru, zh, en
- Бот: @grammyjs/i18n + Fluent (.ftl), locale файлы в `apps/tg-bot/src/bot/locales/`
- API: ErrorCode enum → бот маппит на локализованные строки (error-CODE ключи в .ftl)
- AI-комментарии: Claude возвращает двуязычные comment/reasoning при language≠ru
- ProductNote: `message` (всегда русский, для админки и логов) + `messageLocalized` (язык пользователя бота)
- Статичные замечания: `common/note-translations.ts` (5 hardcoded ключей × en/zh): `verification-disabled`, `verification-error`, `verification-no-result`, `interpreter-disabled`, `interpreter-failed`
- Excel: заголовки всегда на русском, доп. колонка с переведёнными замечаниями только для не-ru пользователей бота
- Язык пользователя: TelegramUser.language (DB) → Document.language (при загрузке) → pipeline → notification

## Дополнительная документация

- `docs/AI_USAGE_TRACKING.md` — учёт расхода токенов Claude (где хранится, как считается, как работает страница `/ai-costs`)
- `docs/AI_CONFIG.md` — конфигурация моделей Claude для 4 AI-сценариев (CRUD, кэш, маппинг tier→model ID)
- `docs/development.md`, `docs/infrastructure.md` — общая инфраструктура и dev-окружение

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
- Очереди: BullMQ через Redis, обе стороны (api producer, tg-bot consumer) подключены к одному Redis
- После любых изменений в коде API запускай `pnpm test` из корня репозитория и убедись, что все тесты проходят. Если изменения затрагивают поведение сервисов или формат ответов — обнови соответствующие тесты и моки
- Если видишь более простой подход — скажи и пушбэкай, не реализуй молча
- Неотносящийся dead code упоминай, но не удаляй — это отдельная задача
- Соблюдай существующий стиль кода, даже если сделал бы иначе
