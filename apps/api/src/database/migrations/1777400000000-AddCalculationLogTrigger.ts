import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalculationLogTrigger1777400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calculation_logs" ADD COLUMN IF NOT EXISTS "trigger" varchar(16) NOT NULL DEFAULT 'full'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "calculation_logs" DROP COLUMN IF EXISTS "trigger"`);
  }
}
