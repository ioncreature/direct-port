import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentFreight1778500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "freight_cost" numeric(14,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "freight_currency" varchar(3)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "freight_currency"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "freight_cost"`);
  }
}
