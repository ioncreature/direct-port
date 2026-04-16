import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCodeReviewRequiredStatus1777100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'code_review_required'`,
    );
    await queryRunner.query(
      `ALTER TABLE "calculation_config" ADD COLUMN IF NOT EXISTS "confidence_threshold" numeric(3,2) NOT NULL DEFAULT 0.80`,
    );
    await queryRunner.query(
      `ALTER TABLE "calculation_config" ADD COLUMN IF NOT EXISTS "low_confidence_action" varchar(16) NOT NULL DEFAULT 'review'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calculation_config" DROP COLUMN IF EXISTS "low_confidence_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calculation_config" DROP COLUMN IF EXISTS "confidence_threshold"`,
    );
    // PostgreSQL does not support removing enum values
  }
}
