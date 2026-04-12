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
 * несмотря на инструкцию "отвечай только JSON". Эта утилита снимает обёртку
 * перед JSON.parse.
 */
export function parseClaudeJson(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/** Оборачивает system prompt для Anthropic prompt caching (cache_control: ephemeral). */
export function cachedSystemPrompt(text: string) {
  return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }];
}
