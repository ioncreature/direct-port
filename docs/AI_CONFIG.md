# AI Config

Конфигурация выбора моделей Claude для всех AI-сценариев системы. Хранится в БД и редактируется через админку без передеплоя.

## Зачем

В DirectPort 5 различных сценариев вызова Claude (см. CLAUDE.md, раздел «Пять точек применения AI»). У каждого свои требования к качеству и цене:

- Парсер таблиц — дорогой, но критичный для качества входных данных
- Классификатор ТН ВЭД — критичный для правильности кодов
- Vision-retry классификации — фактчекит low-confidence строки по фото, vision-токены вдвое дороже текстовых
- Интерпретатор пошлин — нужен только для нетривиальных ставок
- Перевод поисковых запросов — короткие промпты, можно дешёвую модель

Чтобы балансировать качество/цену без правки кода и пересборки, выбор модели для каждого сценария вынесен в БД.

## Модель данных

Entity: `apps/api/src/database/entities/ai-config.entity.ts` (таблица `ai_config`, single row, `id=1`).

```typescript
type AiModelTier = 'opus' | 'sonnet' | 'haiku';

class AiConfig {
  id: 1;
  parserModel: AiModelTier;            // дефолт: 'sonnet'
  queryFormulationModel: AiModelTier;  // дефолт: 'haiku'
  classifierModel: AiModelTier;        // дефолт: 'sonnet'
  interpreterModel: AiModelTier;       // дефолт: 'sonnet'
  photoClassifierModel: AiModelTier;   // дефолт: 'sonnet'
  updatedAt: Date;
}
```

Маппинг tier → конкретный model ID — в `apps/api/src/ai-config/ai-config.service.ts`:

```typescript
opus   → claude-opus-4-7
sonnet → claude-sonnet-4-6
haiku  → claude-haiku-4-5-20251001
```

При смене модельной линейки Claude правится этот маппинг — БД остаётся прежней (там лежат только tier-имена).

## API

Контроллер `apps/api/src/ai-config/ai-config.controller.ts`:

| Метод | Путь | Роли | Назначение |
|---|---|---|---|
| GET | `/ai-config` | ADMIN, CUSTOMS | Текущая конфигурация (все 5 полей) |
| PUT | `/ai-config` | ADMIN | Частичное обновление (любое подмножество полей) |

DTO для PUT (`UpdateAiConfigDto`) — все поля `@IsOptional()`, валидируются через `@IsIn(['opus', 'sonnet', 'haiku'])`.

## Использование в сервисах

`AiConfigService` экспортирует 5 геттеров, возвращающих готовый model ID:

```typescript
service.getParserModel()             // → 'claude-sonnet-4-6'
service.getQueryFormulationModel()   // → 'claude-haiku-4-5-20251001'
service.getClassifierModel()         // → 'claude-sonnet-4-6'
service.getInterpreterModel()        // → 'claude-sonnet-4-6'
service.getPhotoClassifierModel()    // → 'claude-sonnet-4-6'
```

Сервисы (AiParser, Classifier для основного и vision-retry проходов, DutyInterpreter, TnVed) должны вызывать соответствующий геттер перед каждым запросом к Claude и использовать возвращённую строку как `model` в `anthropic.messages.create()`.

⚠️ **Текущее расхождение:** `TnVedService.translateToRussian()` (`tn-ved.service.ts:257`) хардкодит `claude-sonnet-4-6` вместо вызова `getQueryFormulationModel()`. Это надо поправить — иначе изменение поля `queryFormulationModel` в админке не имеет эффекта.

## Кэш

`AiConfigService` кэширует результат `get()` на 60 секунд (`CACHE_TTL = 60_000`). Кэш сбрасывается при `update()`. Это значит:
- При высокой нагрузке БД не становится узким местом
- После смены модели в админке эффект виден через ≤1 минуту (на всех воркерах независимо)

Без распределённого кэша это рассинхрон между несколькими экземплярами API на короткое время — приемлемо, т.к. AI-вызовы идут асинхронно через BullMQ.

## UI

В админке: «Настройки» (`apps/admin-web/src/app/(dashboard)/settings/page.tsx`), компонент `AiModelsSection`. Использует хук `useAiConfig` (`apps/admin-web/src/hooks/use-ai-config.ts`), описание сценариев — в `ai-steps.ts` рядом со страницей.

## Расширение

Добавить новый AI-сценарий:
1. Добавить колонку в `AiConfig` entity + миграция
2. Добавить геттер в `AiConfigService` с фолбэком на `MODEL_IDS.sonnet` (или другой подходящий tier)
3. Добавить поле в `UpdateAiConfigDto`
4. Использовать в новом сервисе
5. Добавить в `AiModelsSection` админки
