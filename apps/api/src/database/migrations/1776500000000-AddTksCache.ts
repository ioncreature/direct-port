import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTksCache1776500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tks_cache" (
        "key" varchar(1024) PRIMARY KEY,
        "category" varchar(20) NOT NULL DEFAULT 'other',
        "value" jsonb NOT NULL,
        "fetched_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tks_cache_category" ON "tks_cache" ("category")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tks_cache_category"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tks_cache"`);
  }
}
