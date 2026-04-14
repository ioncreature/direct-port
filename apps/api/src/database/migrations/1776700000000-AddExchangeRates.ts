import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExchangeRates1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD "exchange_rates" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "exchange_rates"`,
    );
  }
}
