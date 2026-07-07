import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Недостающие индексы под реальные запросы + снятие неиспользуемого GIN.
 *
 * documents — самая большая и никогда не чистящаяся таблица, при этом до сих пор
 * индексированная только по company_id (+ partial по активным статусам):
 * - (telegram_user_id): счётчики документов в списке/детали Telegram-клиентов
 *   (loadRelationCountAndMap), фильтр списка документов, весь кабинет клиента
 *   (скоуп по аккаунту → telegram_user_id) — всё это seq scan без него;
 * - (company_id, created_at): дефолтный список документов «WHERE company_id
 *   ORDER BY created_at DESC LIMIT» и series дашборда;
 * - (company_id, status): фильтр списка по статусу + status-counts для бейджей.
 *
 * telegram_users: (billing_account_id) — резолв клиента по аккаунту в client-portal
 * и EXISTS-подзапросы биллинга дашборда; (assigned_manager_id) — список клиентов
 * менеджера (managed-флоу).
 *
 * Аудит/кэш под фоновые очистки (PipelineAuditRetentionService, cleanup TKS-кэша):
 * ai_call(started_at), pipeline_stage_run(started_at), document_version(created_at),
 * tks_cache(fetched_at) — DELETE по возрасту без полного скана таблицы.
 *
 * idx_documents_token_usage (GIN по token_usage) снимается: ни один запрос не
 * использует containment-операторы (@>/?), агрегаты токенов идут через
 * jsonb_each + SUM, а documents обновляется на каждом этапе pipeline — GIN
 * оплачивался write-амплификацией впустую.
 */
export class AddPerformanceIndexes1781300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_documents_telegram_user" ON "documents" ("telegram_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_documents_company_created_at" ON "documents" ("company_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_documents_company_status" ON "documents" ("company_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_telegram_users_billing_account" ON "telegram_users" ("billing_account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_telegram_users_assigned_manager" ON "telegram_users" ("assigned_manager_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_call_started_at" ON "ai_call" ("started_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pipeline_stage_run_started_at" ON "pipeline_stage_run" ("started_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_version_created_at" ON "document_version" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tks_cache_fetched_at" ON "tks_cache" ("fetched_at")`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_documents_token_usage"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_documents_token_usage" ON "documents" USING GIN ("token_usage")`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tks_cache_fetched_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_version_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipeline_stage_run_started_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_call_started_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_telegram_users_assigned_manager"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_telegram_users_billing_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_company_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_company_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_telegram_user"`);
  }
}
