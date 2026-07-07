import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiCall } from '../database/entities/ai-call.entity';
import { DocumentVersion } from '../database/entities/document-version.entity';
import { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';

const SWEEP_INTERVAL_MS = 12 * 60 * 60_000;
const FIRST_SWEEP_DELAY_MS = 10 * 60_000;
/** Батч удаления: держим транзакции короткими, не блокируем таблицу надолго. */
const DELETE_BATCH_SIZE = 5000;

/**
 * Ретеншен аудит-таблиц pipeline. ai_call (полные request/response Claude),
 * pipeline_stage_run (JSONB output этапов) и document_version (snapshot parsedData
 * на каждый reparse) пишутся на каждый прогон, а документы никогда не удаляются —
 * каскадная очистка (ON DELETE CASCADE) не срабатывает ни разу, и таблицы растут
 * безлимитно. Аудит — диагностический инструмент, а не источник данных расчёта:
 * старше N дней он не нужен (расчётная история живёт в calculation_logs, токены —
 * в documents.token_usage и ai_usage_log).
 *
 * Сроки настраиваются через env: PIPELINE_AUDIT_RETENTION_DAYS (ai_call +
 * pipeline_stage_run, по умолчанию 90) и DOCUMENT_VERSION_RETENTION_DAYS
 * (по умолчанию 180). Удаление батчами по created/started_at; конкурентные запуски
 * с нескольких реплик безопасны (перекрывающиеся DELETE просто удалят меньше).
 */
@Injectable()
export class PipelineAuditRetentionService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(PipelineAuditRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstSweep: NodeJS.Timeout | null = null;
  private readonly auditRetentionDays: number;
  private readonly versionRetentionDays: number;

  constructor(
    @InjectRepository(AiCall) private aiCallRepo: Repository<AiCall>,
    @InjectRepository(PipelineStageRun) private stageRunRepo: Repository<PipelineStageRun>,
    @InjectRepository(DocumentVersion) private versionRepo: Repository<DocumentVersion>,
    config: ConfigService,
  ) {
    this.auditRetentionDays = Number(config.get('PIPELINE_AUDIT_RETENTION_DAYS')) || 90;
    this.versionRetentionDays = Number(config.get('DOCUMENT_VERSION_RETENTION_DAYS')) || 180;
  }

  onModuleInit(): void {
    this.firstSweep = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.firstSweep.unref?.();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstSweep) clearTimeout(this.firstSweep);
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    const auditCutoff = new Date(Date.now() - this.auditRetentionDays * 24 * 60 * 60_000);
    const versionCutoff = new Date(Date.now() - this.versionRetentionDays * 24 * 60 * 60_000);
    // ai_call первым: у него FK на stage_run (CASCADE), явный порядок делает
    // удаление детей независимым от каскада и дешевле для больших батчей.
    await this.deleteInBatches(this.aiCallRepo, 'ai_call', 'started_at', auditCutoff);
    await this.deleteInBatches(this.stageRunRepo, 'pipeline_stage_run', 'started_at', auditCutoff);
    await this.deleteInBatches(this.versionRepo, 'document_version', 'created_at', versionCutoff);
  }

  private async deleteInBatches(
    // Нужен только raw query; структурный тип обходит инвариантность Repository<T>.
    repo: { query(sql: string, params?: unknown[]): Promise<Array<{ count: number }>> },
    table: string,
    column: 'started_at' | 'created_at',
    cutoff: Date,
  ): Promise<void> {
    try {
      let total = 0;
      // Батчами через ctid-подзапрос: DELETE в Postgres не поддерживает LIMIT напрямую.
      // CTE с COUNT(*) — стабильная форма ответа (одна строка) независимо от того,
      // как драйвер отдаёт результат «голого» DELETE.
      for (;;) {
        const res: Array<{ count: number }> = await repo.query(
          `WITH del AS (
             DELETE FROM ${table}
             WHERE ctid IN (
               SELECT ctid FROM ${table} WHERE ${column} < $1 LIMIT ${DELETE_BATCH_SIZE}
             )
             RETURNING 1
           )
           SELECT COUNT(*)::int AS count FROM del`,
          [cutoff],
        );
        const deleted = res[0]?.count ?? 0;
        total += deleted;
        if (deleted < DELETE_BATCH_SIZE) break;
      }
      if (total > 0) {
        this.logger.log(`Retention sweep: deleted ${total} row(s) from ${table} older than ${cutoff.toISOString()}`);
      }
    } catch (err) {
      this.logger.error(`Retention sweep failed for ${table}`, err);
    }
  }
}
