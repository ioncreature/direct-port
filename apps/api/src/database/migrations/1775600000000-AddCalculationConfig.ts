import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalculationConfig1775600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "calculation_config" (
        "id" SERIAL PRIMARY KEY,
        "price_percent" DECIMAL(8,4) NOT NULL DEFAULT 5,
        "weight_rate" DECIMAL(10,4) NOT NULL DEFAULT 0,
        "fixed_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Singleton row with defaults
    await queryRunner.query(`
      INSERT INTO "calculation_config" ("price_percent", "weight_rate", "fixed_fee")
      VALUES (5, 0, 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "calculation_config"`);
  }
}
