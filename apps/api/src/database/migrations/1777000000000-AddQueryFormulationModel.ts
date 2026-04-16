import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQueryFormulationModel1777000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_config" ADD "query_formulation_model" varchar(10) NOT NULL DEFAULT 'haiku'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_config" DROP COLUMN "query_formulation_model"`);
  }
}
