import type Anthropic from '@anthropic-ai/sdk';

/** Извлекает объединённый текст из всех text-блоков ответа Claude. */
export function extractClaudeText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
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
