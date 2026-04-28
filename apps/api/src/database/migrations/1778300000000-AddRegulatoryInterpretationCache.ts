import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegulatoryInterpretationCache1778300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE regulatory_interpretation_cache (
        note_hash VARCHAR(64) NOT NULL,
        language VARCHAR(10) NOT NULL,
        model VARCHAR(100) NOT NULL,
        explanation JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (note_hash, language, model)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_regulatory_interpretation_cache_fetched_at ON regulatory_interpretation_cache (fetched_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_regulatory_interpretation_cache_fetched_at`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS regulatory_interpretation_cache`);
  }
}
