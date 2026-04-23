import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Справочник стран переехал в статический TS-файл (apps/api/src/countries/oksmt.data.ts) —
 * отдельная таблица-кэш и интеграция с TKS API больше не нужны.
 */
export class DropCountriesCache1777500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "countries_cache"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
}
