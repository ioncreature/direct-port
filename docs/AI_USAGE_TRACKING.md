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

Ключи внешнего объекта — стадия pipeline (`parse`, `classify`, `interpret`). Ключи внутреннего — model ID (с обрезанным date-suffix через `normalizeModelId()`, т.е. `claude-haiku-4-5` вместо `claude-haiku-4-5-20251001`).

Сюда пишутся вызовы, которые относятся к конкретному документу: AiParser, Classifier, DutyInterpreter. Запись делает воркер документа после успешного завершения этапа.

Утилиты — `apps/api/src/common/token-usage.ts`:
- `tokenUsageFromResponse(model, usage)` — собирает `TokenUsageMap` из ответа Anthropic SDK
- `mergeTokenUsage(a, b)` — суммирует per-model
- `addStageUsage(map, stage, usage)` — добавляет в нужную стадию
- `normalizeModelId(model)` — стрипает дату из ID

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

В подвале — текущие тарифы (хардкод в компоненте): Sonnet — $3 / $15 за 1M, Haiku — $1 / $5 за 1M. При обновлении прайс-листа Anthropic нужно править здесь.

## Что добавлять в код при новом AI-вызове

1. Если вызов в рамках pipeline документа → собрать `TokenUsageMap` через `tokenUsageFromResponse(model, response.usage)` и положить в `tokenUsage[stage]` через `addStageUsage()`. Сохранить документ.
2. Если вызов вне документа → `aiUsageLogRepo.save({ model: normalizeModelId(model), purpose: 'своё-имя', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens })`. Save можно делать fire-and-forget (без `await`), как в TnVedService — это не критичный путь.
3. Если появилась новая модель Claude — добавить её цену в `apps/admin-web/src/lib/format.ts` и в подвал страницы ai-costs.
