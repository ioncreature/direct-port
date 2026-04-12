/** Per-model token counts */
export type TokenUsageMap = Record<string, { inputTokens: number; outputTokens: number }>;

/** Per-stage, per-model token counts stored on Document */
export type TokenUsageByStage = Record<string, TokenUsageMap>;

export function emptyTokenUsageMap(): TokenUsageMap {
  return {};
}

/** Create a single-model entry from an Anthropic API response */
export function tokenUsageFromResponse(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): TokenUsageMap {
  return { [model]: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } };
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
