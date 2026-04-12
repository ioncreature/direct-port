import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiConfig1776400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_config" (
        "id" SERIAL PRIMARY KEY,
        "parser_model" varchar(10) NOT NULL DEFAULT 'sonnet',
        "classifier_model" varchar(10) NOT NULL DEFAULT 'sonnet',
        "interpreter_model" varchar(10) NOT NULL DEFAULT 'sonnet',
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `INSERT INTO "ai_config" ("parser_model", "classifier_model", "interpreter_model") VALUES ('sonnet', 'sonnet', 'sonnet') ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_config"`);
  }
}
