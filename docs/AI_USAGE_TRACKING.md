# AI Usage Tracking

Учёт всех вызовов Claude в DirectPort: что и куда пишется, как агрегируется, где смотреть.

## Зачем

API-доступ к Claude — основная переменная стоимости системы. Каждый шаг pipeline и каждый поиск в справочнике ТН ВЭД делает запрос к Anthropic. Чтобы видеть расход в разрезе пользователей, документов, моделей и времени — все usage events логируются в БД.

## Хранилища

Учёт ведётся в двух местах с разной семантикой:

### 1. `Document.tokenUsage` (JSONB)

Поле на сущности `Document`. Структура — `TokenUsageByStage`:

```typescript
type TokenUsageByStage = Record<string, TokenUsageMap>;
type TokenUsageMap = Record<string, {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}>;
```

Ключи внешнего объекта — стадия pipeline (`parse`, `classify`, `interpret`). Ключи внутреннего — семейство модели Claude (`haiku` / `sonnet` / `opus`), полученное через `modelFamily()`. Конкретный version ID (например `claude-opus-4-8`) для аналитики стоимости и UX-фильтра не нужен — версии меняются по нескольку раз в год, раздувают список и ломают сводку при апгрейде. Точная версия для вызова Anthropic SDK живёт в `AiConfigService.MODEL_IDS`.

Сюда пишутся вызовы, которые относятся к конкретному документу: AiParser, Classifier (основной проход + vision-retry — оба идут в стадию `classify`), DutyInterpreter. Запись делает воркер документа после успешного завершения этапа.

`ai_call.purpose` (детальный per-call audit, см. ниже): `parse_structure / parse_products / parse_chunk / parse_validate / classify_formulate_queries / classify / classify_retry / classify_vision / interpret / translate_query`.

Утилиты — `apps/api/src/common/token-usage.ts`:
- `tokenUsageFromResponse(model, usage)` — собирает `TokenUsageMap` из ответа Anthropic SDK (ключ — семейство)
- `mergeTokenUsage(a, b)` — суммирует per-model
- `addStageUsage(map, stage, usage)` — добавляет в нужную стадию
- `modelFamily(model)` — сворачивает любой model ID в `haiku`/`sonnet`/`opus`

### 2. Таблица `ai_usage_log` (entity `AiUsageLog`)

Отдельная таблица для вызовов Claude, которые **не привязаны к документу**. Сейчас сюда пишется только `purpose='translate'` — перевод поисковых запросов в TnVedService (см. `apps/api/src/tn-ved/tn-ved.service.ts:273`).

Колонки: `id`, `model`, `purpose`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `createdAt`.

Если в будущем появятся другие AI-вызовы вне pipeline (admin-side translation, ad-hoc анализ) — их нужно писать сюда.

## Агрегация

Все запросы статистики объединяют оба источника через UNION/SQL: `Document.tokenUsage` через `jsonb_each()` + `ai_usage_log` напрямую. Реализация — в `DocumentsService` (`apps/api/src/documents/documents.service.ts`).

### Endpoints

Все требуют роль `ADMIN`:

| Метод | Путь | Что возвращает |
|---|---|---|
| GET | `/documents/token-stats` | `today / week / month / total` per-model + `byUser` + `recentDocuments` (10 шт.) + `availableModels`. Опц. `?model=` для фильтра |
| GET | `/documents/token-stats/monthly` | Только месячные итоги per-model |
| GET | `/documents/token-stats/daily` | По дням (`?days=30`, max 90) per-model. Заполняет пропущенные дни нулями |

Стоимость не считается на сервере — фронтенд делает это локально через `calcAiCostFromMap()` / `calcAiCostFromStages()` в `apps/admin-web/src/lib/format.ts`.

## UI

Страница `/ai-costs` (`apps/admin-web/src/app/(dashboard)/ai-costs/page.tsx`):

- 4 карточки: «Сегодня», «Неделя», «Месяц», «Всего» — стоимость и количество документов
- Фильтр по моделям (кнопки сверху)
- График расходов по дням за 30 дней
- Таблица «Расходы по пользователям» (включая `null` = админка)
- Таблица «Последние документы» с переходом на детали

В подвале — текущие тарифы (хардкод в компоненте): Claude Haiku — $1 / $5 за 1M, Claude Sonnet — $3 / $15 за 1M, Claude Opus — $5 / $25 за 1M. При обновлении прайс-листа Anthropic нужно править здесь.

## Что добавлять в код при новом AI-вызове

1. Если вызов в рамках pipeline документа → собрать `TokenUsageMap` через `tokenUsageFromResponse(model, response.usage)` и положить в `tokenUsage[stage]` через `addStageUsage()`. Сохранить документ.
2. Если вызов вне документа → `aiUsageLogRepo.save({ model: modelFamily(model), purpose: 'своё-имя', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens })`. Save можно делать fire-and-forget (без `await`), как в TnVedService — это не критичный путь.
3. Если появилось новое семейство Claude — добавить его в `MODEL_CONFIG` (`apps/admin-web/src/lib/format.ts`), в `modelFamily()` (api и admin) и в подвал страницы ai-costs. Ребрендинг ревизий в пределах семейства (например, sonnet-4-7) править нигде не нужно — нормализация идёт по подстроке.
