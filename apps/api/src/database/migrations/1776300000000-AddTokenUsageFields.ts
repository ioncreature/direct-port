import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenUsageFields1776300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "input_tokens" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "output_tokens" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "output_tokens"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "input_tokens"`);
  }
}
