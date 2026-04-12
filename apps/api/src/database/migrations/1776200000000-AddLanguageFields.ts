import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageFields1776200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN "language" varchar(5) NOT NULL DEFAULT 'ru'`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "language" varchar(5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "language"`);
    await queryRunner.query(`ALTER TABLE "telegram_users" DROP COLUMN "language"`);
  }
}
