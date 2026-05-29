import type Anthropic from '@anthropic-ai/sdk';
import type { AiCallPurpose } from '../database/entities/ai-call.entity';
import type { AuditContext, PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import { CLAUDE_TIMEOUT_PIPELINE_MS, cacheTools, systemPrompt } from './claude';
import { modelFamily, tokenUsageFromResponse, type TokenUsageMap } from './token-usage';

/**
 * effort для всех pipeline-вызовов Claude. Управляет глубиной reasoning и общим
 * расходом токенов; дефолт API — 'high'. Ставим 'medium' (баланс качество/стоимость)
 * для одношаговых structured-tool вызовов DirectPort. Допустимые значения:
 * 'low' | 'medium' | 'high' | 'max' ('max' — только Opus-tier; 'xhigh' появился
 * на Opus 4.7, но типами SDK 0.82.0 ещё не описан).
 *
 * НЕ применяется к семейству Haiku — оно возвращает 400 на любой effort. queryFormulation
 * по умолчанию идёт на haiku, поэтому гейтим по семейству модели (см. callClaudeTool).
 */
const PIPELINE_EFFORT = 'medium' as const;

export interface ClaudeToolCallParams {
  /** Модель Claude (резолвится через AiConfigService.getXxxModel()). */
  model: string;
  /** System-prompt в чистом виде. cache_control навешивается автоматически. */
  systemPrompt: string;
  /** Сообщения. Если string — заворачиваем в `[{ role: 'user', content }]`. */
  userMessage: string | Anthropic.MessageParam[];
  /** Один tool для tool_choice = { type: 'any' }. */
  tool: Anthropic.Messages.Tool;
  maxTokens: number;
  /** Если true, последний tool помечается cache_control: ephemeral. */
  useCache?: boolean;
  /** По умолчанию CLAUDE_TIMEOUT_PIPELINE_MS (90s). */
  timeoutMs?: number;
}

export interface ClaudeToolAuditParams {
  context: AuditContext | null;
  purpose: AiCallPurpose;
  attempt?: number;
  /**
   * Дополнительные поля для AiCall.request (поверх стандартных
   * model/max_tokens/system/messages/tools/tool_choice). Сюда уходят
   * метаданные для observability — batchSize, indices, codes и т.п.
   * Игнорируется, если задан `auditRequestOverride`.
   */
  extraRequest?: Record<string, unknown>;
  /**
   * Если задан — полностью заменяет default-payload в `ai_call.request`.
   * Используется, когда стандартного раскрытия `messages` нужно избежать —
   * например vision-вызов кладёт в audit `photoHash`/`photoSizeBytes`/`prompt`
   * вместо base64-байтов фото, иначе строка распухает на ~270 KB.
   */
  auditRequestOverride?: Record<string, unknown>;
}

/**
 * Единая обёртка над `audit.trackAiCall(...) → anthropic.messages.create(...)`.
 * Заменяет 6 почти идентичных копий в pipeline-сервисах
 * (classifier × 3, ai-parser × 2, duty-interpreter × 1).
 *
 * Все вызовы — tool_use с одним tool и `tool_choice: { type: 'any' }`. Если нужно
 * несколько tools или другой tool_choice — это отдельный случай, общий helper
 * не подходит.
 */
export async function callClaudeTool(
  anthropic: Anthropic,
  audit: PipelineAuditService,
  call: ClaudeToolCallParams,
  auditParams: ClaudeToolAuditParams,
): Promise<{ response: Anthropic.Message; tokenUsage: TokenUsageMap }> {
  const messages: Anthropic.MessageParam[] =
    typeof call.userMessage === 'string'
      ? [{ role: 'user', content: call.userMessage }]
      : call.userMessage;

  // Семейство Haiku не поддерживает effort (вернёт 400) — применяем только к Opus/Sonnet.
  const effortConfig =
    modelFamily(call.model) === 'haiku'
      ? {}
      : { output_config: { effort: PIPELINE_EFFORT } };

  const auditRequest =
    auditParams.auditRequestOverride ?? {
      model: call.model,
      max_tokens: call.maxTokens,
      system: call.systemPrompt,
      messages,
      tools: [call.tool.name],
      tool_choice: 'any',
      ...effortConfig,
      ...auditParams.extraRequest,
    };

  const response = await audit.trackAiCall(
    {
      context: auditParams.context,
      purpose: auditParams.purpose,
      attempt: auditParams.attempt,
      model: call.model,
      request: auditRequest,
    },
    () =>
      anthropic.messages.create(
        {
          model: call.model,
          max_tokens: call.maxTokens,
          system: systemPrompt(call.systemPrompt),
          messages,
          tools: cacheTools([call.tool], call.useCache ?? false),
          tool_choice: { type: 'any' },
          ...effortConfig,
        },
        { timeout: call.timeoutMs ?? CLAUDE_TIMEOUT_PIPELINE_MS },
      ),
  );

  return {
    response,
    tokenUsage: tokenUsageFromResponse(call.model, response.usage),
  };
}
