import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDutyInterpretationCache1777700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE duty_interpretation_cache (
        tnved_code VARCHAR(10) NOT NULL,
        language VARCHAR(10) NOT NULL,
        model VARCHAR(100) NOT NULL,
        interpretation JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tnved_code, language, model)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_duty_interpretation_cache_fetched_at ON duty_interpretation_cache (fetched_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_duty_interpretation_cache_fetched_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS duty_interpretation_cache`);
  }
}
