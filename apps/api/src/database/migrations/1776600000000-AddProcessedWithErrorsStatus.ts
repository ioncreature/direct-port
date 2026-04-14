import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcessedWithErrorsStatus1776600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'processed_with_errors'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values
  }
}
