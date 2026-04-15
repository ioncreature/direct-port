import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiUsageLog1776900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ai_usage_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model VARCHAR(100) NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        cache_creation_tokens INT NOT NULL DEFAULT 0,
        cache_read_tokens INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_ai_usage_log_created_at ON ai_usage_log (created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ai_usage_log`);
  }
}
