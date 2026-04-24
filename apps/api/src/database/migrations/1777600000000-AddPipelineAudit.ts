import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPipelineAudit1777600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pipeline_stage_run (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        stage VARCHAR(32) NOT NULL,
        attempt INT NOT NULL DEFAULT 1,
        status VARCHAR(16) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        duration_ms INT,
        output JSONB,
        error JSONB,
        token_usage JSONB,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_pipeline_stage_run_document ON pipeline_stage_run (document_id, started_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pipeline_stage_run_stage ON pipeline_stage_run (stage, started_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_pipeline_stage_run_failed ON pipeline_stage_run (status) WHERE status = 'failed'`,
    );

    await queryRunner.query(`
      CREATE TABLE ai_call (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stage_run_id UUID REFERENCES pipeline_stage_run(id) ON DELETE CASCADE,
        document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
        purpose VARCHAR(64) NOT NULL,
        model VARCHAR(100) NOT NULL,
        attempt INT NOT NULL DEFAULT 1,
        request JSONB NOT NULL,
        response JSONB,
        error JSONB,
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        cache_creation_tokens INT NOT NULL DEFAULT 0,
        cache_read_tokens INT NOT NULL DEFAULT 0,
        latency_ms INT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_ai_call_stage_run ON ai_call (stage_run_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ai_call_document ON ai_call (document_id, started_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ai_call_purpose ON ai_call (purpose, started_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE document_version (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version INT NOT NULL,
        reason VARCHAR(32) NOT NULL,
        actor_type VARCHAR(16),
        actor_id VARCHAR(64),
        snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (document_id, version)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_document_version_document ON document_version (document_id, version DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS document_version`);
    await queryRunner.query(`DROP TABLE IF EXISTS ai_call`);
    await queryRunner.query(`DROP TABLE IF EXISTS pipeline_stage_run`);
  }
}
