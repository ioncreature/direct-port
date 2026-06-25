# Client Cabinet (личный кабинет клиента)

> **Статус: Ф0 + Ф1 реализованы; Ф2/Ф3 — дизайн.** Документ фиксирует согласованную
> продуктовую рамку и архитектуру для разворачивания по фазам (см. раздел «Фазы»). Имена
> сущностей/эндпоинтов Ф0/Ф1 — фактические (`apps/client-bff`, `apps/client-web`, модуль
> `ClientPortal` в api, неймспейс `/internal/client/*`); имена Ф2/Ф3 — предложения.

Личный кабинет клиента на отдельном домене: клиент видит баланс и историю, сам
загружает документы и запускает расчёт (self-service), оформляет пополнение баланса.
Сегодня клиент существует только внутри Telegram (managed-флоу: пишет боту → менеджер
запускает pipeline вручную). Кабинет добавляет веб-самообслуживание поверх уже готового
депозитного ядра, не ломая managed-флоу.

## Зачем

- Ввели оплату по балансу (депозит в «позициях») — клиенту нужно место, где видно баланс
  и историю списаний.
- ЦА — логистические компании; им удобнее веб-витрина (баланс + статусы документов +
  скачивание результатов в одном месте), чем переписка с менеджером.
- Снять с менеджера рутину запуска расчёта по типовым документам: клиент сам грузит и
  запускает, менеджер остаётся в денежном контуре (подтверждение пополнений) и на разборе
  нестандартных случаев.

## Объём

| Уровень | Что умеет клиент | Фаза |
|---|---|---|
| Минимум | Видеть баланс и историю операций, статусы своих документов, скачивать результат | Ф1 |
| + Пополнение | Оформить заявку на пополнение; менеджер подтверждает после оплаты | Ф2 |
| Максимум | Сам загрузить документ и отправить на расчёт (self-service) | Ф3 |

## Что уже готово и переиспользуется

Депозитное ядро реализовано и работает в админке — кабинет строится поверх него, а не с нуля.

- **Баланс + ledger:** `TelegramUser.balance` (в позициях), журнал `DepositTransaction`
  (`topup`/`charge`/`adjustment`), `Document.balanceChargedAmount` (идемпотентность).
- **`ClientBalanceService`** (`apps/api/src/balance/client-balance.service.ts`):
  `checkProcessingAllowed` (гейт перед запуском), идемпотентный `settle`/`reconcileCharge`
  (списание под `pessimistic_write`-локом, возврат при пересчёте), `adjust` (ручное
  пополнение/корректировка), `listTransactions`. Конкурентность и идемпотентность уже
  закрыты — переписывать механику не нужно.
- **Запуск pipeline:** атомарные переходы статусов, гейт по балансу
  (`blockIfInsufficientBalance` в `documents.processor.ts`), очереди `document-parsing` →
  `document-processing`.
- **Уведомления менеджеру:** очередь `manager-notifications` + `ManagerNotifyService`
  (переиспользуется для заявок на пополнение и онбординга нового клиента).
- **`Document.source='self_service'`** уже существует в enum; `PipelineNotifierService`
  для него — no-op.
- **Регистрация клиента:** `POST /telegram-users/register` (upsert по `telegramId`).

Новое: отдельный фронт + BFF, контур client-auth, денежный слой (заявки/пакеты),
вынос баланса на `BillingAccount`.

## Архитектура

### Принципалы

Появляется третий принципал безопасности (сегодня их два):

| Принципал | Кто | Авторизация |
|---|---|---|
| User-JWT | сотрудники (admin/customs/super_admin), админка | email+пароль → JWT |
| X-Internal-Key | боты, service-to-service | общий секрет |
| **client-session** (новый) | клиент в кабинете | Telegram Login → client-JWT |

Client-JWT **не открывает** ни одного админского эндпоинта; админский/internal — ни одного
`/client/*`. Принципалы не пересекаются.

### Сервисы и домены

- **`apps/client-web`** (Next.js) — фронт кабинета, отдельный домен (напр. `cabinet.directport.ru`).
- **`apps/client-bff`** (NestJS) — backend-for-frontend: держит client-сессию, верифицирует
  Telegram Login, скоупит запросы по владельцу баланса. **В БД напрямую не ходит.**
- **`apps/api`** — единственный владелец БД, биллинга и pipeline. Под кабинет получает
  client-scoped internal-эндпоинты (как `intake/*` для client-bot, `manager/*` для manager-bot).

> ⚠️ **Один writer баланса.** BFF не заводит свой TypeORM/`ClientBalanceService`/миграции.
> Любое движение по балансу — только через `apps/api`. Иначе два писателя на одну таблицу
> разъедутся. Это ключевое правило, на нём держится безопасность денег.

Локальный dev (PM2): BFF и фронт получают свободные порты (api=3001, admin=3000,
landing/client-bot=3003, manager-bot=3004 уже заняты → BFF напр. 3005, client-web напр. 3006).

### Поток BFF ↔ api

```
Браузер ──client-JWT──▶ client-bff ──X-Internal-Key──▶ api ──▶ PostgreSQL / BullMQ
   │                        │                            │
   │  Telegram Login        │  verify hash,              │  ClientBalanceService,
   │  Widget                │  выдать/обновить JWT,       │  pipeline, ledger —
   │                        │  скоуп по accountId         │  единственный владелец
```

BFF в основном проксирует + держит сессию; вся доменная логика — в `api`.

## Аутентификация клиента

### Telegram Login flow

1. Кабинет показывает **Telegram Login Widget** (привязан к client-bot; домен прописан боту
   через `@BotFather` → `/setdomain`).
2. Клиент подтверждает в Telegram → виджет отдаёт
   `{id, first_name, last_name, username, photo_url, auth_date, hash}`.
3. BFF верифицирует подпись: `secret = SHA256(bot_token)`,
   проверяет `hash == HMAC_SHA256(data_check_string, secret)` и свежесть `auth_date`
   (≤ N минут — защита от replay).
4. BFF → `api` (internal): upsert `TelegramUser` по `telegramId`, создать/привязать
   `BillingAccount`, вернуть `{telegramUserId, billingAccountId}`.
5. BFF выдаёт **client-JWT** (`sub = billingAccountId`, короткий TTL + refresh).
6. Все `/client/*` скоупятся по субъекту из JWT.

Пароли/email не вводятся — identity целиком телеграмная. Тот же `telegramId`, что в боте,
поэтому кабинет и бот — один и тот же клиент.

### Изоляция данных

- BFF **никогда** не доверяет id из тела запроса — владелец берётся только из JWT.
- Каждый internal-вызов в `api` несёт `accountId`; `api` проверяет принадлежность ресурса
  (`document.billingAccountId === accountId` и т.п.). Чужой документ/транзакция недоступны.
- Rate-limit на логин и загрузку.

## Модель данных

### `BillingAccount` (новая)

Владелец баланса. Сейчас **1:1** с клиентом; FK заложен под будущее «компания + N сотрудников»
(1:N) без переписывания биллинга.

```typescript
class BillingAccount {
  id: string;            // uuid
  balance: number;       // int, позиции — переезжает сюда из TelegramUser.balance
  companyId: string | null;  // тенант (как у TelegramUser); проставляется при claim
  createdAt: Date;
  updatedAt: Date;
}
```

### `TelegramUser` (изменения)

- `+ billingAccountId: string` (FK → `billing_accounts.id`). Пока ровно один аккаунт на клиента.
- `- balance` — переезжает в `BillingAccount`. Резолв владельца: `telegramUser.billingAccountId`.

### `DepositTransaction` (изменения)

- `telegramUserId` → переключается на `billingAccountId` (ledger принадлежит аккаунту).
- `type` расширяется: `'topup' | 'charge' | 'adjustment' | 'grant'`.
  - **`grant`** — бесплатные кредиты, выдаёт только менеджер (free «первые 50/100»). Отделён
    от `topup`, чтобы бесплатные не попадали в выручку и не возвращались деньгами.
- `+ sourceRequestId: string | null` (FK → `top_up_requests.id`) — для топ-апа из заявки.
  Уникальность по `sourceRequestId` (где не null) → подтверждение заявки идемпотентно.

### `TopUpRequest` (новая) — денежный слой

Кредитный ledger остаётся «в позициях». Деньги живут отдельно — в заявке на пополнение.

```typescript
type TopUpStatus = 'pending' | 'confirmed' | 'canceled';

class TopUpRequest {
  id: string;
  billingAccountId: string;
  createdByTelegramUserId: string;   // кто из сотрудников оформил (для будущего 1:N)
  packageKey: string | null;         // ссылка на пакет из справочника
  positions: number;                 // сколько кредитов запрошено
  amount: number;                    // деньги (numeric)
  currency: string;                  // 'USD' и т.п.
  pricePerPosition: number;          // зафиксированная цена за позицию на момент заявки
  status: TopUpStatus;
  confirmedByUserId: string | null;  // менеджер, подтвердивший оплату
  confirmedAt: Date | null;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Подтверждение (`confirmed`) → `ClientBalanceService` создаёт топ-ап-транзакцию
(`type='topup'`, `delta=+positions`, `sourceRequestId=request.id`) под тем же локом, что и
прочие операции. Денежные поля фиксируются в заявке, баланс пополняется в кредитах.

### Пакеты (прайсинг)

Справочник тарифов — конфигом (таблица не обязательна на старте). Соответствует лендингу:

```typescript
const PACKAGES = [
  { key: 'free',  positions: 50,   amount: 0,    perPosition: 0.00 }, // только grant, выдаёт менеджер
  { key: 'p100',  positions: 100,  amount: 100,  perPosition: 1.00 },
  { key: 'p500',  positions: 500,  amount: 450,  perPosition: 0.90 }, // −10%
  { key: 'p5000', positions: 5000, amount: 4000, perPosition: 0.80 }, // −20%
];
```

Цена за позицию копируется в `TopUpRequest.pricePerPosition` при создании — изменение тарифов
не задним числом.

## Биллинг: правила списания

Документ-контейнер не биллится. **Платим построчно за строки, доведённые до полезного
результата** (статус строки `calculationStatus`, см. `common/product-notes.ts`):

| Статус строки | Значение | Списываем |
|---|---|---|
| `exact` | расчёт чистый | ✅ |
| `partial` | расчёт выполнен, есть warning (низкий confidence кода, страна по умолчанию, фрахт не вошёл) | ✅ |
| `needs_info` | blocker: не хватило данных для точной пошлины | ❌ |
| `error` | blocker: код ТН ВЭД не определён | ❌ |

`settle` уже так считает: `successfulCount` = строки, не являющиеся `error`/`needs_info`
(`isIncompleteCalculationStatus`). Дополнительно:

- **`FAILED`** — не списываем (наш сбой: TKS/Anthropic/курс).
- **`REQUIRES_REVIEW` / `CODE_REVIEW_REQUIRED`** — не списываем, пока не довели до `PROCESSED`.
  После доведения спишется за `exact`+`partial`.
- **Гейт перед запуском** требует баланс ≥ числа позиций (`rowCount`); по факту списываем
  только за успешные — разница не списывается (в пользу клиента).
- **Спорные `partial`:** держим прозрачность (показываем warning построчно) + менеджер
  возвращает через `adjustment` (одна операция). Списание не усложняем завязкой на причину warning.
- `CHECK balance >= 0` на уровне БД + закрыть щель «гейт по `rowCount` до / `settle` по факту
  после» (между ними баланс мог уйти параллельным документом).

## Флоу пополнения

1. Клиент в кабинете выбирает пакет (или сумму) → BFF → `api` создаёт `TopUpRequest(pending)`.
2. Менеджеру уходит уведомление (`manager-notifications`) с кнопкой подтверждения; в кабинете
   клиенту показываются реквизиты для offline-оплаты.
3. Клиент оплачивает вне системы.
4. Менеджер видит поступление → подтверждает → `TopUpRequest.confirmed` →
   `ClientBalanceService` зачисляет кредиты (`topup` + `sourceRequestId`). Повторное
   подтверждение не задваивает (идемпотентность по `sourceRequestId`).

Переиспользует существующий ручной топ-ап и очередь уведомлений — заявка лишь «обёртка
намерения» с денежными полями поверх него.

## Self-service обработка

- Загрузка из кабинета → `Document(source='self_service', telegramUserId, billingAccountId)`
  → гейт по балансу → `PARSING` → штатный pipeline (тот же, что у админки/бота).
- `REQUIRES_REVIEW` / `CODE_REVIEW_REQUIRED` / `FAILED` → разбирает оператор; клиент видит
  статус и ошибки построчно (`ProductNote.message` / `messageLocalized`). Клиентский
  review-UI (правка `parsedData`) не строим.
- Уведомление о готовности — через client-bot (`client-bot-outgoing`, у клиента уже есть бот)
  и/или статус в кабинете.

## Онбординг нового клиента (claim + free-grant)

Self-service-клиент может прийти в кабинет, ни разу не побыв в managed-чате → у него нет
`assignedManager` и `companyId`, а баланс — 0 (гейт заблокирует первый же запуск).

- **Первое касание** (вход/первая загрузка) → broadcast менеджерам (`manager-notifications`),
  как первое сообщение в managed.
- Менеджер **клеймит** клиента (атомарно `assignedManagerId` + `companyId` на `TelegramUser`,
  `companyId` на `BillingAccount`) и при желании выдаёт **free-grant** 50/100 позиций.
- До claim/гранта запуск обработки заблокирован нулевым балансом — это осознанное следствие
  решения «бесплатные выдаёт только менеджер»: менеджер остаётся точкой входа в деньги,
  self-service касается только запуска при наличии баланса.

## Эндпоинты

### BFF, client-facing (`/client/*`, client-JWT)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/client/auth/telegram` | приём данных виджета, выдача сессии |
| POST | `/client/auth/refresh` | обновление токена |
| GET | `/client/me` | профиль + баланс + менеджер |
| GET | `/client/transactions` | история операций (пагинация) |
| GET | `/client/documents` | список своих документов |
| GET | `/client/documents/:id` | детали (построчно: статусы, notes) |
| GET | `/client/documents/:id/download` | Excel (только `PROCESSED`, только свой) |
| POST | `/client/documents` | загрузка файла + запуск (Ф3) |
| GET | `/client/packages` | справочник пакетов |
| POST | `/client/topups` | создать заявку на пополнение (Ф2) |
| GET | `/client/topups` | свои заявки |

### Новые internal в `apps/api` (X-Internal-Key, client-scoped)

Отдельный неймспейс с обязательной проверкой принадлежности по `accountId` (существующие
`documents`/`telegram-users` эндпоинты — под другими принципалами и без client-скоупа,
переиспользовать их напрямую нельзя).

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/internal/client/resolve` | upsert по `telegramId` → `{accountId}` (для auth) |
| GET | `/internal/client/:accountId/balance` | баланс |
| GET | `/internal/client/:accountId/transactions` | история |
| GET | `/internal/client/:accountId/documents` | список (скоуп по accountId) |
| GET | `/internal/client/:accountId/documents/:id` | детали |
| GET | `/internal/client/:accountId/documents/:id/download` | Excel |
| POST | `/internal/client/:accountId/documents` | upload + self-service start |
| POST | `/internal/client/:accountId/topups` | создать заявку → `manager-notifications` |
| GET | `/internal/client/:accountId/topups` | заявки |

## Фазы реализации

- **Ф0 — биллинг-фундамент (только `apps/api`, кабинета ещё нет) ✅ сделано:** `BillingAccount`
  (1:1) + миграция баланса/ledger на аккаунт + тип `grant`. `ClientBalanceService` лочит/пишет по
  `billingAccountId`. Отложено до ратификации/Ф2: `CHECK balance>=0` и `sourceRequestId` (нет
  таблицы `top_up_requests`).
- **Ф1 — вход + витрина (read-only) ✅ сделано:** `client-bff` (порт 3005) + Telegram Login +
  stateless client-JWT; модуль `ClientPortal` в api (`/internal/client/*`, скоуп по
  `billingAccountId`); `client-web` (порт 3006) — экраны баланс/история/документы/скачать.
  Здесь обкатан auth-контур и изоляция данных.
- **Ф2 — пополнение:** `TopUpRequest` + пакеты + подтверждение менеджером + claim первого
  касания + free-grant.
- **Ф3 — self-service:** загрузка + запуск из кабинета + построчный показ ошибок + уведомление
  о готовности.

Каждая фаза самостоятельно ценна.

> Миграции Ф0/Ф2 — по чек-листу из корневого `CLAUDE.md` («Порядок написания миграций»):
> файл + **явный импорт в `database.module.ts`** + локальный прогон + `pnpm test`. Перенос
> баланса/ledger на `BillingAccount` нормализует существующие данные — учитывать окно
> «миграция применена, под ещё на старом коде» (см. п.5 чек-листа).

## Отложено

- **Abuse self-service:** в self-service парсер тратит токены **до** любого списания
  (в managed это гейтил менеджер кнопкой «Запустить»). Злонамеренная многократная загрузка
  документов, застревающих в `REQUIRES_REVIEW`, обходит оплату. Лечится дёшево (rate-limit на
  загрузки + флаг на повторные `REQUIRES_REVIEW` от одного клиента) — реализуем, если случится.
- **Онлайн-оплата** (платёжный провайдер + вебхуки): пока пополнение только через заявку →
  менеджера. Telegram Payments отпал (не работает в РФ). Денежный слой (`TopUpRequest`)
  спроектирован так, чтобы провайдер подключился, не трогая списание.
- **`$10/файл`:** убрано, документ = 0. Если вернётся — отдельный тип начисления в ledger.
- **Компания-клиент + N сотрудников:** `BillingAccount` уже владелец баланса; расширение до
  1:N — снять ограничение «один `TelegramUser` на аккаунт» и добавить участников, без миграции
  биллинга.
