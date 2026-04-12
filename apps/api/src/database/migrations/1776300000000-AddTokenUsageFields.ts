import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenUsageFields1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD "token_usage" jsonb`);
    await queryRunner.query(`CREATE INDEX "idx_documents_token_usage" ON "documents" USING GIN ("token_usage")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_documents_token_usage"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "token_usage"`);
  }
}
