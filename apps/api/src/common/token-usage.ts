/** Per-model token counts */
export type TokenUsageMap = Record<string, {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}>;

/** Per-stage, per-model token counts stored on Document */
export type TokenUsageByStage = Record<string, TokenUsageMap>;

export function emptyTokenUsageMap(): TokenUsageMap {
  return {};
}

export type ModelFamily = 'haiku' | 'sonnet' | 'opus';

/**
 * Сворачивает любой model ID Claude в семейство (haiku/sonnet/opus). Версии
 * обновляются по нескольку раз в год, и хранить в статистике/audit детальный
 * suffix вида `claude-haiku-4-5-20251001` бесполезно — для аналитики и UX
 * важно семейство, не точная ревизия. Конкретная версия для вызова SDK живёт
 * в `AiConfigService.MODEL_IDS` и в `request` audit-записи AiCall.
 *
 * Возвращает исходную строку, если ни одно семейство не подошло — fallback на
 * случай не-Anthropic моделей в будущем.
 */
export function modelFamily(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return model;
}

/** Create a single-model entry from an Anthropic API response */
export function tokenUsageFromResponse(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
): TokenUsageMap {
  return {
    [modelFamily(model)]: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Merge two per-model maps, summing tokens per model */
export function mergeTokenUsage(a: TokenUsageMap, b: TokenUsageMap): TokenUsageMap {
  const result = { ...a };
  for (const [model, usage] of Object.entries(b)) {
    const existing = result[model];
    if (existing) {
      result[model] = {
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
        cacheCreationTokens: (existing.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0),
        cacheReadTokens: (existing.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      };
    } else {
      result[model] = { ...usage };
    }
  }
  return result;
}

/** Add per-model usage to a specific stage in the by-stage map */
export function addStageUsage(
  map: TokenUsageByStage,
  stage: string,
  usage: TokenUsageMap,
): TokenUsageByStage {
  return { ...map, [stage]: mergeTokenUsage(map[stage] ?? {}, usage) };
}
