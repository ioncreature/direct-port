import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentCountryAndCountriesCache1777300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "country_of_origin" varchar(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "country_origin_source" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "country_detection_reason" text`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "countries_cache" (
        "code" varchar(3) PRIMARY KEY,
        "alpha2" varchar(2),
        "alpha3" varchar(3),
        "name_ru" varchar(255) NOT NULL,
        "name_full_ru" varchar(500),
        "name_en" varchar(255),
        "fetched_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "countries_cache"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "country_detection_reason"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "country_origin_source"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "country_of_origin"`);
  }
}
