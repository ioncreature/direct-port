/** Per-model token usage: { "claude-sonnet-4-6": { inputTokens: 500, outputTokens: 200 }, ... } */
export type TokenUsageMap = Record<string, { inputTokens: number; outputTokens: number }>;

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

/** Merge two maps, summing tokens per model */
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
