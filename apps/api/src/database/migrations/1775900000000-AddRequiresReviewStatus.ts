import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequiresReviewStatus1775900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'requires_review'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values
  }
}
