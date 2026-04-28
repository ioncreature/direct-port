import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegulatoryInterpreterModel1778200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_config ADD COLUMN regulatory_interpreter_model VARCHAR(10) NOT NULL DEFAULT 'haiku'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_config DROP COLUMN IF EXISTS regulatory_interpreter_model`,
    );
  }
}
