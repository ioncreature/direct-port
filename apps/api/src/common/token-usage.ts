export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
