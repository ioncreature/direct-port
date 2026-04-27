import type { TokenUsageByStage, TokenUsageMap } from './types';

export function fmt(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Конфигурация семейств Claude: ценник ($/1M токенов) + подпись для UI.
 * API после миграции NormalizeModelFamilies хранит семейство (haiku/sonnet/opus),
 * не version ID, поэтому ключи здесь — семейства. modelFamily() ниже на всякий
 * случай нормализует входное значение, чтобы устаревшие записи и историю
 * AiCall с конкретной версией мы тоже корректно подписывали.
 */
export const MODEL_CONFIG: Record<string, { label: string; input: number; output: number }> = {
  haiku: { label: 'Claude Haiku', input: 1, output: 5 },
  sonnet: { label: 'Claude Sonnet', input: 3, output: 15 },
  opus: { label: 'Claude Opus', input: 5, output: 25 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

export const STAGE_LABELS: Record<string, string> = {
  parser: 'Парсинг',
  classifier: 'Классификация',
  interpreter: 'Интерпретация',
};

function modelFamily(model: string): string {
  const m = (model || '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return model;
}

export function modelLabel(model: string): string {
  const family = modelFamily(model);
  return MODEL_CONFIG[family]?.label ?? model;
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Calculate cost from a per-model token usage map (cache-aware).
 * Anthropic API: input_tokens = non-cached input, cache_creation/read are separate. */
export function calcAiCostFromMap(map: TokenUsageMap | null | undefined): number {
  if (!map) return 0;
  let cost = 0;
  for (const [model, usage] of Object.entries(map)) {
    const pricing = MODEL_CONFIG[modelFamily(model)] ?? DEFAULT_PRICING;
    cost += (
      usage.inputTokens * pricing.input +
      (usage.cacheCreationTokens ?? 0) * pricing.input * 1.25 +
      (usage.cacheReadTokens ?? 0) * pricing.input * 0.1 +
      usage.outputTokens * pricing.output
    ) / 1_000_000;
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

/** Sum all tokens across models in a per-model map.
 * inputTokens = non-cached input; cache tokens are counted separately. */
export function totalTokensFromMap(map: TokenUsageMap | null | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const usage of Object.values(map)) {
    total += usage.inputTokens + (usage.cacheCreationTokens ?? 0) + (usage.cacheReadTokens ?? 0) + usage.outputTokens;
  }
  return total;
}

/** Sum all tokens across stages and models. */
export function totalTokensFromStages(map: TokenUsageByStage | null | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const stageMap of Object.values(map)) {
    total += totalTokensFromMap(stageMap);
  }
  return total;
}

export function fmtCost(usd: number): string {
  return '$' + usd.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function fmtDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ru');
}

export function fmtDateTimeLocale(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('ru');
}

export function fmtFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(2)} с`;
}
