# DirectPort

Сервис для импорта товаров в Россию: оформление деклараций, расчёт пошлин и налогов.

## Стек

- Монорепозиторий: pnpm 10+ workspaces
- Backend: NestJS + TypeORM (apps/api, порт 3001)
- Админка: Next.js (apps/admin-web, порт 3000)
- Лендинг: Next.js (apps/landing, порт 3003) — публичный маркетинговый сайт directport.ru, CTA ведут в client-bot (managed-флоу)
- Клиентский бот: NestJS + grammY (apps/client-bot, порт 3003) — приём файлов от клиентов + чат с менеджером
- Менеджерский бот: NestJS + grammY (apps/manager-bot, порт 3004) — уведомления, запуск пайплайна, ответы клиентам
- BFF кабинета: NestJS (apps/client-bff, порт 3005) — backend-for-frontend личного кабинета: Telegram Login → client-JWT, ходит в api по X-Internal-Key, в БД напрямую не лезет
- Кабинет клиента: Next.js (apps/client-web, порт 3006) — личный кабинет (вход через Telegram, баланс, история операций, документы, скачивание результата)
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
- Модули верхнего уровня (app.module.ts): Auth, Users, TnVed, TelegramUsers, Documents, Conversations, CalculationConfig, AiConfig, Countries, Regulatory, BotLinks, TopUp, ClientPortal
  - Auth, Users — авторизация и управление пользователями
  - TnVed — справочник ТН ВЭД: поиск по TKS API (searchGoodsGrouped + getTnvedCode), перевод запросов через Claude, обогащение ставками + блок `regulatoryReport` в `codeDetail` (Regulatory)
  - TelegramUsers — регистрация пользователей Telegram, детальный просмотр по UUID, PATCH :telegramId/language
  - Documents — загрузка (Telegram + админка), обработка, переобработка, скачивание, token-stats. Зонтичный модуль: агрегирует внутри AiParser/Classifier/Calculator/DutyInterpreter/Currency/CalculationLogs/Tks, они не импортируются на верхнем уровне
  - CalculationConfig — настройки формулы комиссии, флага отправки Excel, порога уверенности классификатора (CRUD)
  - AiConfig — CRUD для выбора моделей Claude (opus/sonnet/haiku) для 4 сценариев AI. См. `docs/AI_CONFIG.md`
  - Countries — справочник стран (OKSMT), используется для страны происхождения товара
  - Regulatory — формирует RegulatoryReport (сертификация, лицензии, маркировка, утильсбор, страновые запреты) из блоков `TnvedCode.TNVEDALL` по PRIZNAK 6/7/11–15/21/27–29/33–35. Парсер NOTE извлекает ТР ТС/ЕАЭС, форму оценки, регулятора. Отдельных запросов к TKS не делает — использует уже загруженный TnvedCode. В pipeline вызывается из `DocumentsProcessor` после Calculator (см. `attachRegulatoryReports`) и сохраняется в `resultData[i].regulatoryReport`. Lazy AI-обогащение через `RegulatoryInterpreterService` (Claude haiku по умолчанию, persistent-кэш `regulatory_interpretation_cache` 180д, ключ — sha256(NOTE)+language+model). Endpoints: `GET /tn-ved/:code/regulatory-explanations?lang=ru` (для справочника) и `GET /documents/:id/regulatory-explanations?lang=ru` (для всех позиций документа одним запросом)
  - Conversations — API-мост managed-флоу (client-bot ↔ manager-bot). От client-bot (X-Internal-Key): `POST /intake/documents` (managed-документ без автозапуска), `POST /intake/messages`. Для manager-bot (X-Internal-Key): `POST /manager/link`, `GET /manager/clients`, `POST /manager/clients/:id/claim`, `POST /manager/messages`, `POST /manager/documents/:id/start`. Привязка из админки (ADMIN): `POST /managers/:userId/telegram-link-token`, `DELETE /managers/:userId/telegram-link`. История переписки: `GET /telegram-users/by-id/:id/messages`. Очереди `manager-notifications` (→ manager-bot) и `client-bot-outgoing` (→ client-bot). `ManagerNotifyService` резолвит адресата (назначенный менеджер или broadcast по всем привязанным). Уведомления о состоянии документа идут только по managed-флоу: `PipelineNotifierService.notify(doc)` (в `DocumentsModule`) для `Document.source='managed'` зовёт `ManagerNotifyService.notifyDocumentEvent`, для self_service — no-op (после удаления tg-bot self_service-уведомлений нет). Entity `ConversationMessage`; токены привязки в Redis (`RedisModule`)
  - BotLinks — ссылки на Telegram-ботов для админки. client-bot и manager-bot при старте резолвят свой username через `getMe` и публикуют его: `POST /bot-links/identity` (X-Internal-Key, body `{kind: 'client'|'manager', username}`). Админка читает `GET /bot-links` (ADMIN/CUSTOMS) → `{client, manager}` с полем `url` (`https://t.me/<username>`). Хранилище — Redis без TTL (`bot-link:<kind>`, `BotLinksService`); при сбросе Redis ссылки восстанавливаются после ближайшего рестарта ботов. Отображается блоком «Telegram-боты» на дашборде
  - ClientPortal — client-scoped internal-API личного кабинета (потребитель — client-bff, auth ТОЛЬКО по X-Internal-Key, `@Internal()`). Неймспейс `/internal/client/*`: `POST /resolve` (upsert клиента → `{telegramUserId, billingAccountId}`, обёртка над `TelegramUsersService.register`), `GET /:accountId/balance`, `GET /:accountId/transactions`, `GET /:accountId/documents`, `GET /:accountId/documents/:id`, `GET /:accountId/documents/:id/download` (Excel, только PROCESSED). Ф2 (пополнение): `GET /packages`, `POST /:accountId/topups` (создать заявку, фикс цены сервером), `GET /:accountId/topups`, `POST /:accountId/topups/:id/cancel`. `accountId` приходит из проверенного client-JWT; документы/заявки скоупятся по `billing_account_id`, чужой ресурс → 404. Переиспользует `ClientBalanceService`, `TopUpService`, `ExcelExportService` (экспортирован из `DocumentsModule`). См. `docs/CLIENT_CABINET.md`
  - TopUp — денежный слой кабинета (Ф2). `TopUpService`: создание заявки на пополнение (`TopUpRequest`, цена фиксируется из пакета `top-up/packages.ts`, уведомление менеджеру через `manager-notifications`), список/отмена клиентом, подтверждение/отклонение менеджером. Зачисление кредитов — `ClientBalanceService.confirmTopUp` (под локом аккаунта, идемпотентно по `DepositTransaction.sourceRequestId`; единый writer баланса сохранён). `ManagerTopUpController` (`@Internal`, `/manager/topups/:id/confirm|cancel`) — для manager-bot (резолв менеджера по `managerTelegramId`). Пакеты: `p100/p500/p5000` покупаемые, `free` — только grant менеджером (онбординг, отложен)
- Вложенные модули (внутри DocumentsModule):
  - AiParser — AI-парсинг таблиц (Claude): определение валюты, перевод, извлечение данных, автодетект страны происхождения. Retry + валидация
  - Classifier — классификация+верификация ТН ВЭД: TKS search (батчи по 5) → Claude classify+verify (батчи по 10) → getTnvedCode
  - Calculator — расчёт пошлин, НДС, акцизов, комиссии за доставку
  - DutyInterpreter — AI-интерпретация правил расчёта пошлин из справочника ТН ВЭД (Claude)
  - CalculationLogs — аудит-лог расчётов (запись после обработки, доступ через GET /documents/:id/calculation-history)
  - Currency — курсы валют ЦБ РФ, конвертация в RUB
  - Tks — shared-инфраструктура: TksApiClient + PgTksCacheStore (PostgreSQL-кэш TKS API)
- Common: PaginationQueryDto, PaginatedResponse, ErrorCode (коды ошибок для i18n), ProductNote (messageLocalized), note-translations, token-usage (утилиты для TokenUsageByStage) — shared инфраструктура
- Очереди BullMQ: document-parsing (AI-парсинг), document-processing (классификация/расчёт). Уведомления менеджеру по managed-флоу идут через очередь `manager-notifications` (Conversations), не через отдельную document-notifications
- Entities: User, RefreshToken, TnVedCode, TelegramUser (+ language, billingAccountId), Document (+ language, countryOfOrigin, tokenUsage, freightCost+freightCurrency), CalculationConfig, CalculationLog, TksCache, AiConfig, AiUsageLog, BillingAccount, DepositTransaction (+ sourceRequestId), TopUpRequest
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
- Справочник ТН ВЭД: поиск по TKS API (текст/код), перевод запросов через Claude (модель настраивается через AiConfig), кликабельные коды, копирование кода, калькулятор пошлин с учётом единиц измерения (кг/л/м²/м³/шт). Секция «Разрешительные документы и ограничения» — сертификация, разрешения, лицензии, маркировка, утильсбор, страновые запреты — со сводкой и бейджем точности применимости (exact/narrow/broad). AI-выжимки записей загружаются ленивым запросом через `useRegulatoryExplanations` после показа базового отчёта
- Настройки: формула комиссии (pricePercent, weightRate, fixedFee), порог уверенности классификатора (confidenceThreshold + lowConfidenceAction), отправка Excel пользователю бота (sendResultFile), выбор моделей Claude для 4 AI-сценариев
- Shared: InfoCard, table-styles, format (fmt), хуки с серверной пагинацией
- API-клиент с автообновлением токенов
- Отдельной страницы «Логи расчётов» нет — история доступна на странице деталей документа (вкладка/секция «История расчётов»)

### apps/landing — Публичный лендинг (Next.js)

- Маркетинговый сайт directport.ru (App Router, без бэкенда и БД). Деплоится отдельным подом: Dockerfile + Helm `landing-deployment`/`landing-service`; в локальном dev — в PM2 (`ecosystem.config.js`)
- Одна страница `src/app/page.tsx`: Hero → блок боли → «Как работает» (managed-флоу: пишете боту → менеджер → 10 мин → Excel) → цена ($1/позиция + $10/файл) → «Почему расчёту можно доверять» → «Что внутри расчёта» → справочник ТН ВЭД → CTA. Тексты бренда и SEO вынесены в `src/app/_brand.ts`, стили — единый `globals.css` (CSS-переменные, без UI-библиотек; зависимости только next/react)
- Позиционирование: расчёт пошлин на весь контейнер за 10 минут (до ~500 позиций), ЦА — логистические компании. Все CTA ведут в Telegram-бот (managed-флоу); self-service-загрузки файла на сайте нет
- ENV: `NEXT_PUBLIC_TELEGRAM_BOT_URL` (ссылка на бота, дефолт `https://t.me/direct_port_bot`), `NEXT_PUBLIC_SITE_URL` (для metadataBase/OpenGraph). Контактный email захардкожен в `page.tsx`
- ⚠️ Порт 3003 совпадает с `client-bot` (`BOT_PORT=3003`): в k8s изолировано по подам, но локально через `pnpm dev` оба одновременно не поднимутся (EADDRINUSE)

### apps/client-bot — Клиентский бот (managed-флоу)

- grammY + @grammyjs/i18n (ru/zh/en), команды /start, /help, /language. Порт 3003
- Приём файла: .xlsx/.csv → `POST /intake/documents` (X-Internal-Key) → Document(source=managed, status=INTAKE) **без автозапуска пайплайна**
- Любой текст/фото/не-таблица → `POST /intake/messages` (релей менеджеру). Каждый xlsx/csv становится отдельным Document, остальное — вложения переписки
- Воркер `client-bot-outgoing` (BullMQ) → доставка ответов менеджера клиенту
- Без выбора колонок/уточнения кодов (это берёт на себя AI-парсер + менеджер). Состояние в Redis `client-conv:<chatId>` {telegramUserId, language}, TTL 24ч

### apps/manager-bot — Менеджерский бот (managed-флоу)

- grammY, ru-only (без i18n). Порт 3004. Команды /start `<token>` (привязка), /clients, /help
- Привязка: `/start <token>` → `POST /manager/link` → связывает Telegram-аккаунт с User (`managerTelegramId`). Токен генерится в админке на странице менеджера (хранится в Redis, TTL 15 мин)
- Воркер `manager-notifications` (BullMQ) → уведомления менеджерам с inline-кнопками (🚀 Запустить расчёт, 👤 Взять, ✍️ Ответить, ↗️ В админке — deep-link через ADMIN_WEB_BASE_URL)
- Callback: `claim:<clientId>` (закрепить клиента), `start:<docId>` (запустить пайплайн), `reply:<clientId>` (режим ответа), `confirm-topup:<id>`/`cancel-topup:<id>` (подтвердить/отклонить заявку на пополнение — Ф2). Активный диалог в Redis `mgr:active:<chatId>`, TTL 1ч
- Маршрутизация нового клиента — broadcast всем привязанным менеджерам, первый жмёт «Взять» (claim, атомарно)

### apps/client-bff — BFF личного кабинета (Telegram Login → client-JWT)

- NestJS, порт 3005. Третий принципал безопасности (помимо User-JWT и X-Internal-Key) — client-session. **В БД напрямую не ходит**: вся доменная логика и биллинг — в api (единственный writer баланса)
- `POST /client/auth/telegram` — приём данных Telegram Login Widget, верификация подписи (`TelegramAuthService`: `secret=SHA256(bot_token)`, `hash==HMAC_SHA256(data_check_string, secret)` + свежесть `auth_date`; `TELEGRAM_BOT_TOKEN` — токен client-bot, к которому привязан виджет). Затем резолв клиента в api (`/internal/client/resolve`) и выдача client-JWT
- client-JWT (`ClientTokenService`): `sub=billingAccountId`, stateless access+refresh (refresh — тоже JWT, `typ='refresh'`, отзыва нет — осознанный компромисс Ф1, BFF без БД/Redis). Профиль для дашборда переносится в токен. `ClientAuthGuard` защищает неймспейс `/client/*` (кроме `/client/auth/*`), кладёт принципал в `req.client` (`@CurrentClient()`)
- `PortalController` (`/client/me`, `/transactions`, `/documents`, `/:id`, `/:id/download`; Ф2: `/client/packages`, `POST/GET /client/topups`, `POST /client/topups/:id/cancel`) — проксирует в api по X-Internal-Key, `accountId` и `telegramUserId` берутся ТОЛЬКО из JWT (никогда из тела/пути запроса). `AxiosExceptionFilter` пробрасывает статус ошибок api (404 остаётся 404, недоступность api → 502)
- Подробности — `docs/CLIENT_CABINET.md`. Ф3 (self-service загрузка) — следующая фаза

### apps/client-web — Личный кабинет клиента (Next.js)

- Next.js App Router, порт 3006. Отдельный домен (напр. `cabinet.directport.ru`). Браузер ходит в свой `/api/[...path]` → проксируется в client-bff (`CLIENT_BFF_URL`), токены — в localStorage (как admin-web)
- Страница входа (`/`): Telegram Login Widget (`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, домен кабинета прописывается боту через `@BotFather` → `/setdomain`) → `loginWithTelegram` → дашборд
- Дашборд (`/dashboard`): баланс (в позициях), история операций (`DepositTransaction`), список документов со статусами, скачивание Excel (только PROCESSED). Ф2 — секция «Пополнить баланс»: выбор пакета → заявка → реквизиты offline-оплаты (`NEXT_PUBLIC_PAYMENT_DETAILS`) + список заявок со статусами и отменой pending (`components/top-up-section.tsx`)
- Стиль — единый `globals.css` (CSS-переменные, палитра как у landing/admin-web; без UI-библиотек). `lib/api.ts` — axios с авто-refresh (зеркало admin-web)

### libs/tks-api — Клиент API таможенного справочника (api1.tks.ru)

- Поиск товаров: searchGoods, searchGoodsGrouped, searchGoodsByCode
- Справочник ТН ВЭД: getTnvedCode (ставки IMP/NDS/AKC), getTnvedCodeList
- Справочники: страны (OKSMT), экономические зоны (EK AR)
- In-memory кэш (dev) или PostgreSQL кэш (prod): дедупликация запросов, stale fallback при недоступности API
- TksCacheStore интерфейс: get/set/delete/clear + опциональный getStale (fallback)

## Pipeline обработки документа

```
Загрузка файла (client-bot managed-интейк: POST /intake/documents → запуск менеджером; Админка: POST /documents/upload-admin)
→ Сохранение fileBuffer в БД, status=PARSING → BullMQ: document-parsing (ответ за 1-2с)
→ [Воркер] AiParser (Claude): определение структуры, валюты, перевод, извлечение данных, автодетект страны происхождения (countryOfOrigin + countryOriginSource: ai_explicit | ai_language | ai_currency | manual | default; дефолт — Китай 156)
→ Валидация (детерминистическая + AI), retry до 2 попыток
→ Если confident → status=PENDING → BullMQ: document-processing → status=PROCESSING
→ Если не confident → status=REQUIRES_REVIEW → ручная проверка в админке (PATCH :id/review + POST :id/reprocess, POST :id/approve или POST :id/reject)
→ [Воркер] Classifier+Verify (TKS API: searchGoodsGrouped → Claude classify+verify → getTnvedCode)
→ Vision-retry (Phase 4.5): для строк с `matchConfidence < confidenceThreshold` при наличии фото в `document_photo` — отправка изображения + текста + текущего кода в Claude (`photoClassifierModel`), подтверждение или корректировка кода
→ Если все коды с низкой уверенностью и lowConfidenceAction='review' → status=CODE_REVIEW_REQUIRED
→ DutyInterpreter (Claude: интерпретация правил расчёта пошлин; пропускается для чисто адвалорных ставок без условий по стране/акциза/спецчасти)
→ При language≠ru: Claude возвращает comment_localized / reasoning_localized для двуязычных замечаний
→ Calculator (пошлина + НДС + акциз + комиссия, конвертация валют → RUB)
→ resultData + CalculationLog (аудит) + tokenUsage
→ status=PROCESSED (или PROCESSED_WITH_ERRORS, если есть проблемные строки)
→ Уведомление: PipelineNotifierService.notify(doc) — для managed-документа событие менеджеру в manager-bot (очередь manager-notifications), для self_service — no-op
```

BullMQ очереди: `document-parsing` → `document-processing`. Уведомление менеджеру по managed-флоу — через `manager-notifications` (Conversations).

**Надёжность pipeline:**
- parse-job ставится с `attempts: 3` (exponential backoff 30s) — транзиентные сбои Anthropic ретраятся, FAILED только на последней попытке; `fileBuffer` при FAILED сохраняется (для reprocess). processing-job — `attempts: 1` осознанно (воркер не идемпотентен: CalculationLog, уведомления)
- Оба воркера на входе проверяют статус документа (parse: PARSING, processing/recalculate: PENDING) — stalled-повторы и двойные клики не задваивают прогон
- Переходы статусов в `startProcessing`/`reprocess` атомарные (`UPDATE ... WHERE status = :expected`) — конкурентный запуск получает 400
- `StuckDocumentsWatchdog` (каждые 10 мин): документы в PARSING/PENDING/PROCESSING без записи > 60 мин → FAILED «обработка прервана» → оператор перезапускает reprocess'ом
- Недоступный курс ЦБ на финальной конвертации НЕ роняет AI-работу: resultData сохраняется без RUB-полей, статус FAILED с понятной ошибкой → дешёвый `recalculate` доконвертирует
- Полный отказ TKS (0 matched + сбои поиска) → FAILED с `TKS_UNAVAILABLE`, а не REJECTED с обвинением данных клиента
- Очереди `client-bot-outgoing`/`manager-notifications` — `attempts: 5`; боты пробрасывают временные ошибки Telegram (429/5xx/сеть) для ретрая, неисправимые (бот заблокирован) уходят в failed без повторов

Переобработка: `POST /documents/:id/reprocess` — если есть parsedData → document-processing, если нет (но есть fileBuffer) → document-parsing, если нет ни того ни другого → 400.

Пересчёт: `POST /documents/:id/recalculate` — повторно прогнать классификатор/калькулятор с новыми параметрами (страна происхождения, стоимость фрахта), не парся файл заново. Body: `countryOfOrigin?`, `freightCost?`, `freightCurrency?` (USD/CNY/RUB/EUR). Если поле не передано — берётся сохранённое значение из документа.

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
| POST | `/upload-admin` | ADMIN, CUSTOMS | Загрузка из админки (multipart: file + опц. `freightCost` + `freightCurrency`) |
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
- Колонка «Разрешительные документы» — компактная сводка из `regulatoryReport` (например, `ТР ТС 020/2011 декл.; Маркировка с 01.05.2026; Утильсбор 32 874 ₽`)
- Стилизация: синий заголовок, автофильтр, заморозка строки заголовка
- При document.language≠ru: доп. колонка «Notes (translated)» / «备注（翻译）» с локализованными замечаниями

### Формула расчёта

Если у документа задан фрахт до границы (`Document.freightCost` + `freightCurrency`), он конвертируется в валюту документа по курсу ЦБ РФ и распределяется по позициям пропорционально весу × количеству. Бизнес ожидает вес брутто; если в parsedData есть только нетто — используется он (предполагается, что парсер AiParser положит туда лучшее доступное значение). Доля попадает в **таможенную стоимость** и через неё — в базу пошлины, акциза и НДС (ТК ЕАЭС).

```
totalPrice     = price × quantity
freightShare   = freightInDocCurrency × (weight × quantity) / Σ(weight × quantity)   // 0 для legacy-документов без фрахта
customsValue   = totalPrice + freightShare
dutyAmount     = customsValue × (dutyRate / 100)
                 // для комбинированных ставок (dutySign='>'): max(dutyAmount, dutyMin × weight × quantity)
exciseAmount   = customsValue × (exciseRate / 100)
vatAmount      = (customsValue + dutyAmount + exciseAmount) × (vatRate / 100)
logisticsComm  = totalPrice × (pricePercent / 100) + weight × quantity × weightRate + fixedFee
totalCost      = totalPrice + freightShare + dutyAmount + vatAmount + exciseAmount + logisticsCommission
```

verificationStatus = matched AND matchConfidence >= 0.7 ? 'exact' : 'review'

**Где задаётся фрахт:** форма загрузки в админке `/documents/upload` (поля «Стоимость фрахта» + валюта USD/CNY/RUB/EUR, по умолчанию USD) и модалка `Пересчитать` на странице деталей документа. client-bot фрахт не запрашивает — для managed-документов из бота `freightShare = 0` и формула эквивалентна legacy. Чтобы сбросить ранее заданный фрахт через recalculate, передайте `freightCost = 0`.

**Распределение в processor.ts:** общий объём `freightInDocCurrency = freightCost × курсCБ(freightCurrency → documentCurrency)`. Если курс недоступен или общий вес нетто = 0 — фрахт игнорируется с warning-логом, расчёт идёт без него (документ не падает).

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

## Порядок написания миграций

**Обязательный чек-лист**, чтобы миграция отработала и в dev, и на stage/prod:

1. Создать файл `apps/api/src/database/migrations/<timestamp>-<Name>.ts` с классом, реализующим `MigrationInterface`. `up` и `down` обязательны (даже если `down` no-op — пиши пустой метод с комментарием почему).
2. **Импортировать класс и добавить его в массив `migrations` в `apps/api/src/database/database.module.ts`.** При старте API применяет миграции через `migrationsRun: true` и берёт их из этого ЯВНОГО списка, а не через glob. Если забыть — миграция тихо НЕ применится, и при следующем релизе сервисы упадут на отсутствующих таблицах/колонках/функциях.
3. Запустить локально: `cd apps/api && pnpm migration:run` — убедиться, что up отработал. После успешного применения выполнить `down` локально не получится (TypeORM ходит по списку только up); проверяй ревёрсность визуально.
4. Прогнать `pnpm test` (из корня) — особенно если миграция меняет схему/нормализует данные, на которые завязаны сервисы.
5. Если миграция нормализует существующие данные (UPDATE по таблицам/JSONB) — учитывай окно «миграция применена, но pod ещё на старом коде»: за это время приложение успеет записать пред-нормализационный формат. Делай SQL-запросы устойчивыми (нормализуй на чтении через permanent SQL-функцию), а не полагайся только на одноразовый UPDATE.
6. Перед коммитом проверь diff `apps/api/src/database/database.module.ts` — там должны быть и `import`, и строка в массиве.

CI/CD migration job тоже использует data-source.ts с glob `src/database/migrations/*` — но в prod-образе только скомпилированный `dist/`, и glob ничего не находит. Поэтому единственный надёжный путь применения миграций — через `migrationsRun: true` API при старте, что и требует пункта 2.

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

## Прочие БД-кэши и хранилища pipeline

- `duty_interpretation_cache` (`DutyInterpretationCache`) — persistent cache интерпретаций пошлин Claude. Ключ `(tnvedCode, language, model)`, TTL 180 дней. Между рестартами и репликами API повторно интерпретировать известные коды не требуется. Реализация — `DutyInterpreterService.loadFromPersistentCache / savePersistentCache`. In-memory L1 (1 час) поверх БД L2.
- `document_photo` (`DocumentPhoto`) — фотографии товаров, извлечённые из xlsx. Ресайз до ≤1024px JPEG (q=85) через `sharp`, sha256-hash для дедупликации, привязка к `rowIndex` в parsedData. Запись — `PhotoStorageService.savePhotos` после успешного парсинга (idempotent: `delete({ documentId })` перед save). Чтение vision-retry'ем — `getFirstByRows(documentId, rowIndices)`. Кап `MAX_IMAGES_PER_DOC=200`. Удаление каскадом при удалении документа.

## Шесть точек применения AI (Claude)

Конкретная модель Claude для каждого сценария настраивается в БД (таблица `ai_config`) через `PUT /ai-config` (только ADMIN). По умолчанию: parser=sonnet, classifier=sonnet, interpreter=sonnet, queryFormulation=haiku, photoClassifier=sonnet, regulatoryInterpreter=haiku. Подробнее — `docs/AI_CONFIG.md`.

1. **Парсинг документов** (AiParserService, поле `parserModel`) — анализ структуры таблицы, определение валюты, перевод наименований, извлечение данных, автодетект страны происхождения. Детерминистическая + AI валидация, retry до 2 попыток
2. **Классификация+верификация кодов ТН ВЭД** (ClassifierService, поле `classifierModel`) — объединённый classify+verify в одном запросе Claude. При language≠ru промпт запрашивает comment_localized для двуязычных замечаний
3. **Vision-retry классификации** (ClassifierService Phase 4.5, поле `photoClassifierModel`) — для строк с `matchConfidence < CalculationConfig.confidenceThreshold` при наличии фото в `document_photo`. Claude получает текст+фото+текущий код через vision-API, подтверждает (повышает confidence) или корректирует код (новый загружается из TKS, переписывает rates). In-memory cache по `imageHash + tnVedCode + language + model`, TTL 24ч, концурент 3. Audit-purpose `classify_vision`. Тихо пропускается, если фото нет / `documentId` не известен / все строки выше threshold
4. **Интерпретация правил расчёта пошлин** (DutyInterpreterService, поле `interpreterModel`) — анализ текстовых правил из справочника ТН ВЭД: комбинированные ставки, специфические пошлины (EUR/кг, EUR/л), акцизы. При language≠ru промпт запрашивает reasoning_localized. Пропускается для чисто адвалорных кодов (нет IMP2/IMPSIGN/AKC/IMPTMP/IMPDEMP/IMPCOMP/flat-currency и нет country/excise conditions) — у них Calculator считает по плоским полям TNVED без AI
5. **Перевод поисковых запросов** (TnVedService, поле `queryFormulationModel`) — перевод запросов в справочнике ТН ВЭД с английского/китайского на русский для поиска в TKS API. max_tokens: 100, timeout: 10с. Graceful degradation: без API-ключа поиск работает без перевода
6. **AI-выжимки разрешительных мер** (RegulatoryInterpreterService, поле `regulatoryInterpreterModel`) — расширенная сводка по NOTE-тексту записи TKS (что/кто/основание/нюансы) для отображения в карточках раздела «Разрешительные документы» на /tn-ved. Lazy-load: вызывается через `GET /tn-ved/:code/regulatory-explanations`, не блокирует первичный показ. Persistent cache в `regulatory_interpretation_cache` 180д по ключу sha256(NOTE)+language+model. По умолчанию haiku — задача требует выжимки, не reasoning. Покрывает все категории мер (сертификация, лицензии, маркировка, страновые запреты и т. д.). audit-purpose: `regulatory_interpret`

Все вызовы Claude учитываются: токены парсера/классификатора (включая vision-retry)/интерпретатора записываются в `Document.tokenUsage` (per-stage per-model), вызовы перевода и regulatory-выжимок — в таблицу `ai_usage_log`. См. `docs/AI_USAGE_TRACKING.md`.

## Локализация бота (i18n)

Локализован client-bot (приём файлов + чат с клиентом). Админка и REST API остаются на русском. Изменения в API — исключительно инфраструктурные (хранение языка, коды ошибок, локализованные поля в notes) и не меняют поведение для админки. Уведомления менеджеру (manager-bot) — ru-only.

- Поддерживаемые языки: ru, zh, en
- Бот: @grammyjs/i18n + Fluent (.ftl), locale файлы в `apps/client-bot/src/bot/locales/`
- AI-комментарии: Claude возвращает двуязычные comment/reasoning при language≠ru
- ProductNote: `message` (всегда русский, для админки и логов) + `messageLocalized` (язык клиента)
- Статичные замечания: `common/note-translations.ts` (5 hardcoded ключей × en/zh): `verification-disabled`, `verification-error`, `verification-no-result`, `interpreter-disabled`, `interpreter-failed`
- Excel: заголовки всегда на русском, доп. колонка с переведёнными замечаниями только для не-ru клиентов (Excel доставляется клиенту через client-bot)
- Язык клиента: TelegramUser.language (DB) → Document.language (при интейке) → pipeline → локализованный Excel

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
- Очереди: BullMQ через Redis, продюсер (api) и консьюмеры (client-bot, manager-bot) подключены к одному Redis
- После любых изменений в коде API запускай `pnpm test` из корня репозитория и убедись, что все тесты проходят. Если изменения затрагивают поведение сервисов или формат ответов — обнови соответствующие тесты и моки
- Если видишь более простой подход — скажи и пушбэкай, не реализуй молча
- Неотносящийся dead code упоминай, но не удаляй — это отдельная задача
- Соблюдай существующий стиль кода, даже если сделал бы иначе
- **Автокоммиты запрещены.** Никогда не делай `git commit` или `git push` самостоятельно — только по явной просьбе пользователя в текущем сообщении. Согласие на коммит в прошлом не распространяется на будущие изменения
