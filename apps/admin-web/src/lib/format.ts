import type { TokenUsageByStage, TokenUsageMap } from './types';

export function fmt(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Per-model config: pricing ($/1M tokens) + display label */
export const MODEL_CONFIG: Record<string, { label: string; input: number; output: number }> = {
  'claude-sonnet-4-6': { label: 'Sonnet', input: 3, output: 15 },
  'claude-haiku-4-5': { label: 'Haiku', input: 0.8, output: 4 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

export const STAGE_LABELS: Record<string, string> = {
  parser: 'Парсинг',
  classifier: 'Классификация',
  interpreter: 'Интерпретация',
};

export function modelLabel(model: string): string {
  return MODEL_CONFIG[model]?.label ?? model;
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Calculate cost from a per-model token usage map */
export function calcAiCostFromMap(map: TokenUsageMap | null | undefined): number {
  if (!map) return 0;
  let cost = 0;
  for (const [model, usage] of Object.entries(map)) {
    const pricing = MODEL_CONFIG[model] ?? DEFAULT_PRICING;
    cost += (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
  }
  return cost;
}

/** Calculate cost from a by-stage map (sum across all stages) */
export function calcAiCostFromStages(map: TokenUsageByStage | null | undefined): number {
  if (!map) return 0;
  let cost = 0;
  for (const stageMap of Object.values(map)) {
    cost += calcAiCostFromMap(stageMap);
  }
  return cost;
}

/** Sum all tokens across stages and models */
export function totalTokensFromStages(map: TokenUsageByStage | null | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const stageMap of Object.values(map)) {
    for (const usage of Object.values(stageMap)) {
      total += usage.inputTokens + usage.outputTokens;
    }
  }
  return total;
}

export function fmtCost(usd: number): string {
  return '$' + usd.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function fmtDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
