import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileBufferAndParsingStatus1776100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'parsing' BEFORE 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "file_buffer" bytea`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ALTER COLUMN "column_mapping" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ALTER COLUMN "column_mapping" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "file_buffer"`,
    );
  }
}
