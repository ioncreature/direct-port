import type Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { errMsg } from '../common/errors';
import { normalizeModelId, type TokenUsageMap } from '../common/token-usage';
import { AiCall, type AiCallPurpose } from '../database/entities/ai-call.entity';
import {
  DocumentVersion,
  type DocumentVersionActorType,
  type DocumentVersionReason,
  type DocumentVersionSnapshot,
} from '../database/entities/document-version.entity';
import {
  PipelineStageRun,
  type PipelineStage,
} from '../database/entities/pipeline-stage-run.entity';

export interface StartStageRunInput {
  documentId: string;
  stage: PipelineStage;
  attempt?: number;
  metadata?: Record<string, unknown>;
}

export interface CompleteStageRunInput {
  output?: unknown;
  tokenUsage?: TokenUsageMap | null;
  metadata?: Record<string, unknown>;
}

export interface AuditContext {
  documentId: string;
  stageRunId: string | null;
}

export interface RecordAiCallInput {
  context?: AuditContext | null;
  purpose: AiCallPurpose;
  model: string;
  attempt?: number;
  request: unknown;
  response?: unknown;
  error?: unknown;
  tokens?: {
    input: number;
    output: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
  startedAt: Date;
  finishedAt: Date;
}

export interface TrackAiCallParams {
  context: AuditContext | null;
  purpose: AiCallPurpose;
  model: string;
  attempt?: number;
  /** Полный payload запроса к Claude (system, messages, tools, max_tokens, …). */
  request: unknown;
}

export interface RecordDocumentVersionInput {
  documentId: string;
  reason: DocumentVersionReason;
  actorType?: DocumentVersionActorType;
  actorId?: string | null;
  parsedData: Record<string, unknown>[] | null;
  currency?: string | null;
  columnMapping?: Record<string, number> | null;
}

/**
 * Аудит прохождения документа через pipeline. Запись в БД fire-and-forget:
 * ошибка аудита НЕ должна ломать обработку документа, поэтому все методы
 * поглощают исключения и только логируют.
 */
@Injectable()
export class PipelineAuditService {
  private logger = new Logger(PipelineAuditService.name);

  constructor(
    @InjectRepository(PipelineStageRun)
    private stageRunRepo: Repository<PipelineStageRun>,
    @InjectRepository(AiCall) private aiCallRepo: Repository<AiCall>,
    @InjectRepository(DocumentVersion)
    private versionRepo: Repository<DocumentVersion>,
  ) {}

  async startStageRun(input: StartStageRunInput): Promise<string | null> {
    try {
      const row = await this.stageRunRepo.save(
        this.stageRunRepo.create({
          documentId: input.documentId,
          stage: input.stage,
          attempt: input.attempt ?? 1,
          status: 'running',
          startedAt: new Date(),
          metadata: input.metadata ?? null,
        }),
      );
      return row.id;
    } catch (err) {
      this.logger.warn(
        `Failed to start stage run for ${input.documentId}/${input.stage}: ${errMsg(err)}`,
      );
      return null;
    }
  }

  async completeStageRun(
    stageRunId: string | null,
    input: CompleteStageRunInput = {},
  ): Promise<void> {
    if (!stageRunId) return;
    await this.finishStageRun(stageRunId, 'ok', null, input.output, input.tokenUsage, input.metadata);
  }

  async failStageRun(
    stageRunId: string | null,
    error: unknown,
    extra: { metadata?: Record<string, unknown>; tokenUsage?: TokenUsageMap | null } = {},
  ): Promise<void> {
    if (!stageRunId) return;
    await this.finishStageRun(
      stageRunId,
      'failed',
      this.serializeError(error),
      undefined,
      extra.tokenUsage,
      extra.metadata,
    );
  }

  /**
   * Один UPDATE: финализирует stage_run без предварительного SELECT. `duration_ms`
   * считает PostgreSQL из `started_at`. `metadata` докладывается к существующему
   * через JSONB-concat, output/token_usage/error затираются только если переданы.
   */
  private async finishStageRun(
    stageRunId: string,
    status: 'ok' | 'failed',
    error: unknown,
    output: unknown,
    tokenUsage: TokenUsageMap | null | undefined,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    try {
      await this.stageRunRepo.query(
        `UPDATE pipeline_stage_run
         SET status = $2,
             finished_at = NOW(),
             duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int,
             output = COALESCE($3::jsonb, output),
             error = COALESCE($4::jsonb, error),
             token_usage = COALESCE($5::jsonb, token_usage),
             metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb)
         WHERE id = $1`,
        [
          stageRunId,
          status,
          output !== undefined ? JSON.stringify(output) : null,
          error !== null && error !== undefined ? JSON.stringify(error) : null,
          tokenUsage ? JSON.stringify(tokenUsage) : null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
    } catch (err) {
      this.logger.warn(`Failed to finalize stage run ${stageRunId}: ${errMsg(err)}`);
    }
  }

  /**
   * Обёртка над одним запросом к Claude. Запускает `fn`, измеряет время,
   * затем fire-and-forget пишет в `ai_call` и успешный ответ, и ошибку.
   * Результат `fn` пробрасывается клиенту без изменений; если `fn` кинул —
   * исключение после записи аудит-строки пробрасывается дальше.
   */
  async trackAiCall<T extends Anthropic.Message>(
    params: TrackAiCallParams,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date();
    try {
      const response = await fn();
      const finishedAt = new Date();
      void this.recordAiCall({
        context: params.context,
        purpose: params.purpose,
        model: params.model,
        attempt: params.attempt,
        request: params.request,
        response: this.serializeResponse(response),
        tokens: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheCreation: response.usage.cache_creation_input_tokens ?? 0,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
        },
        startedAt,
        finishedAt,
      });
      return response;
    } catch (err) {
      void this.recordAiCall({
        context: params.context,
        purpose: params.purpose,
        model: params.model,
        attempt: params.attempt,
        request: params.request,
        error: err,
        startedAt,
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  async recordAiCall(input: RecordAiCallInput): Promise<void> {
    try {
      await this.aiCallRepo.save(
        this.aiCallRepo.create({
          stageRunId: input.context?.stageRunId ?? null,
          documentId: input.context?.documentId ?? null,
          purpose: input.purpose,
          model: normalizeModelId(input.model),
          attempt: input.attempt ?? 1,
          request: input.request,
          response: input.response ?? null,
          error: input.error ? this.serializeError(input.error) : null,
          inputTokens: input.tokens?.input ?? 0,
          outputTokens: input.tokens?.output ?? 0,
          cacheCreationTokens: input.tokens?.cacheCreation ?? 0,
          cacheReadTokens: input.tokens?.cacheRead ?? 0,
          latencyMs: input.finishedAt.getTime() - input.startedAt.getTime(),
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record AI call (purpose=${input.purpose}): ${errMsg(err)}`,
      );
    }
  }

  async recordDocumentVersion(input: RecordDocumentVersionInput): Promise<number | null> {
    const snapshot: DocumentVersionSnapshot = {
      parsedData: input.parsedData,
      currency: input.currency ?? null,
      columnMapping: input.columnMapping ?? null,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const latest = await this.versionRepo.findOne({
          where: { documentId: input.documentId },
          order: { version: 'DESC' },
        });
        const version = (latest?.version ?? 0) + 1;
        await this.versionRepo.save(
          this.versionRepo.create({
            documentId: input.documentId,
            version,
            reason: input.reason,
            actorType: input.actorType ?? 'system',
            actorId: input.actorId ?? null,
            snapshot,
          }),
        );
        return version;
      } catch (err) {
        if (err instanceof QueryFailedError && attempt < 2) {
          continue;
        }
        this.logger.warn(
          `Failed to record document version for ${input.documentId}: ${errMsg(err)}`,
        );
        return null;
      }
    }
    return null;
  }

  private serializeResponse(response: Anthropic.Message): unknown {
    return {
      id: response.id,
      type: response.type,
      role: response.role,
      model: response.model,
      content: response.content,
      stop_reason: response.stop_reason,
      stop_sequence: response.stop_sequence,
      usage: response.usage,
    };
  }

  private serializeError(error: unknown): { message: string; stack?: string; code?: string } {
    if (error instanceof Error) {
      const code = (error as { code?: string }).code;
      return {
        message: error.message,
        ...(error.stack ? { stack: error.stack.slice(0, 4000) } : {}),
        ...(typeof code === 'string' ? { code } : {}),
      };
    }
    return { message: String(error) };
  }
}
