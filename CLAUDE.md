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
- AI: Anthropic Claude (верификация кодов ТН ВЭД, перевод наименований)
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
Загрузка файла (Telegram или админка)
→ Выбор колонок → парсинг → перевод наименований (если не на русском)
→ POST /documents (parsedData) → BullMQ: document-processing
→ Classifier (TKS API: searchGoodsGrouped → getTnvedCode)
→ Verification (Claude: верификация кодов, опционально)
→ Calculator (пошлина + НДС + акциз + комиссия, конвертация валют → RUB)
→ resultData → BullMQ: document-notifications
→ Excel-экспорт → отправка пользователю
```

### Форматы данных в pipeline

**Входной файл** (.xlsx или .csv с автодетектом разделителя `,` `;` `\t`):
- 4 обязательные колонки, выбираемые пользователем: описание, цена, вес, количество
- Наименования могут быть на любом языке (часто — китайский); переводятся на русский на этапе парсинга
- Цены могут быть в любой валюте (не только USD) — валюта определяется для всего документа
- Пример: `examples/in_1.xlsx` (китайские наименования, цены в юанях)

**parsedData** (JSONB в Document, массив `ProductRow[]`):
```typescript
interface ProductRow {
  description: string;   // наименование товара (переведённое на русский)
  quantity: number;
  price: number;         // цена в исходной валюте документа
  weight: number;        // вес в кг
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
- `TKS_API_KEY` — ключ для api1.tks.ru (таможенный справочник)
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
- [ ] Упрощение запуска: `pnpm dev` должен автоматически запускать миграции и seed
- [ ] Перенос AI-парсинга в BullMQ: сейчас парсинг блокирует HTTP-запрос (до 90с), нужно сделать асинхронным
- [ ] Интерфейс ручной проверки: оператор в админке должен видеть документы со статусом requires_review и одобрять/отклонять их
- [ ] Интеллектуальный расчёт пошлин и акцизов: правила расчёта зависят от кода ТН ВЭД (комбинированные ставки, минимумы в EUR/кг, ненулевые акцизы на определённые товары). Текущая формула упрощённая — нужен AI для интерпретации правил расчёта из справочника ТН ВЭД (третье место применения Claude после парсинга документов и верификации кодов)

## Три точки применения AI (Claude)

1. **Парсинг документов** (AiParserService) — анализ структуры таблицы, определение валюты, перевод наименований, извлечение данных. С валидацией и retry
2. **Верификация кодов ТН ВЭД** (VerificationService) — проверка и уточнение кодов, предложенных классификатором TKS API
3. **Расчёт пошлин и акцизов** (TODO) — интерпретация правил расчёта из справочника ТН ВЭД: комбинированные ставки, минимумы, акцизы. Правила привязаны к конкретным кодам и содержат сложные условия, которые меняются

## Правила

- Язык общения: русский
- Новые приложения создавать в apps/
- Backend — только NestJS, frontend — только Next.js
- Strict TypeScript во всех проектах
- ORM: TypeORM, миграции через CLI (tsx)
- Бот обращается к API через HTTP (X-Internal-Key), не напрямую к БД
- Очереди: BullMQ через Redis, обе стороны (api producer, tg-bot consumer) подключены к одному Redis
