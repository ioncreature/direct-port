import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentIdToCalculationLog1776000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "calculation_logs" ALTER COLUMN "telegram_user_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "calculation_logs" ADD COLUMN "document_id" UUID REFERENCES "documents"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "calculation_logs" DROP COLUMN "document_id"`);
    await queryRunner.query(
      `UPDATE "calculation_logs" SET "telegram_user_id" = 0 WHERE "telegram_user_id" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "calculation_logs" ALTER COLUMN "telegram_user_id" SET NOT NULL`);
  }
}
