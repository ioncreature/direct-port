import type Anthropic from '@anthropic-ai/sdk';

/**
 * Таймауты на вызовы Claude (мс). Централизованы, чтобы при смене моделей
 * (Opus/Sonnet → следующее поколение, batch size, etc.) не разъезжались
 * по 7 файлам и не возникало «бомб замедленного действия» вроде classify=30s
 * с реальной latency 27s — где любой чуть более тяжёлый батч уходил в timeout.
 *
 * Anthropic SDK ретраит 2-3 раза на каждый таймаут, поэтому фактический
 * worst-case времени ожидания = TIMEOUT × ~3.
 */

/** Тяжёлые batch-вызовы пайплайна: parse_products, classify, formulate_queries, interpret, validate. */
export const CLAUDE_TIMEOUT_PIPELINE_MS = 90_000;

/** Анализ структуры таблицы — задача легче, но на больших файлах нужен запас. */
export const CLAUDE_TIMEOUT_STRUCTURE_MS = 60_000;

/** UI-вызовы вне пайплайна (перевод поисковых запросов в справочнике ТН ВЭД). */
export const CLAUDE_TIMEOUT_UI_MS = 30_000;

/** Извлекает объединённый текст из всех text-блоков ответа Claude. */
export function extractClaudeText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Извлекает input из первого tool_use блока ответа Claude. */
export function extractToolInput<T>(response: Anthropic.Message): T {
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!block) {
    throw new Error('No tool_use block in Claude response');
  }
  return block.input as T;
}

/**
 * Извлекает массив-поле из tool_use input. Возвращает undefined, если поле
 * отсутствует или не массив — наблюдается при stop_reason=max_tokens, когда
 * Claude обрезает генерацию tool_use input. Без этой проверки for-of по полю
 * летит TypeError и роняет весь батч (включая параллельные вызовы вне try/catch).
 * Caller логирует контекст и сам решает fallback.
 */
export function extractToolInputArrayField<T>(
  response: Anthropic.Message,
  field: string,
): T[] | undefined {
  const input = extractToolInput<Record<string, unknown>>(response);
  const arr = input?.[field];
  return Array.isArray(arr) ? (arr as T[]) : undefined;
}

/**
 * @deprecated Используй tool_use + extractToolInput вместо текстового парсинга JSON.
 *
 * Claude периодически возвращает JSON в markdown-обёртке ```json ... ```
 * или предваряет JSON рассуждениями, несмотря на инструкцию "отвечай только JSON".
 * Эта утилита извлекает JSON из ответа:
 * 1. Прямой parse
 * 2. Снятие markdown-обёртки
 * 3. Извлечение первого JSON-объекта/массива из текста
 */
export function parseClaudeJson(text: string): unknown {
  const cleaned = text.trim();

  // 1. Прямой parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  // 2. Markdown-обёртка ```json ... ```
  if (cleaned.startsWith('```')) {
    const unwrapped = cleaned.replace(/^```\s*(?:json)?\s*/, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unwrapped);
    } catch {
      // continue
    }
  }

  // 3. Извлечение JSON-объекта/массива из текста с рассуждениями
  const jsonStart = Math.max(cleaned.lastIndexOf('{'), cleaned.lastIndexOf('['));
  if (jsonStart >= 0) {
    try {
      return JSON.parse(cleaned.slice(jsonStart));
    } catch {
      // continue
    }
  }

  throw new SyntaxError('No valid JSON found in response');
}

/** Оборачивает system prompt для Anthropic API. При cache=true добавляет cache_control: ephemeral. */
export function systemPrompt(text: string, cache = false) {
  return cache
    ? [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }]
    : [{ type: 'text' as const, text }];
}

/**
 * При cache=true добавляет cache_control: ephemeral на последний tool.
 * Кэширует весь префикс (system + tools) целиком — это даёт больший cache-hit
 * чем cache_control на system, т.к. tool schemas обычно крупнее system prompt'а.
 */
export function cacheTools<T extends Anthropic.Messages.Tool>(tools: T[], cache = false): T[] {
  if (!cache || tools.length === 0) return tools;
  const last = tools[tools.length - 1];
  return [
    ...tools.slice(0, -1),
    { ...last, cache_control: { type: 'ephemeral' as const } },
  ];
}
