import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slug компании — стабильный человекочитаемый ключ для личного кабинета per-company
 * (`cabinet.directport.ru/<slug>`): по нему кабинет резолвит компанию и подбирает токен бота
 * для верификации Telegram-логина. См. docs/COMPANY_BOTS.md (Фаза 4).
 *
 * Колонка nullable: компания без slug — норма (обслуживается дефолтным ботом, вход по bare-домену
 * уходит в дефолтную компанию). UNIQUE-индекс: Postgres считает NULL'ы различными, поэтому
 * множество компаний без slug ограничению не противоречит.
 */
const COMPANY_SLUG_UNIQUE = 'UQ_companies_slug';

export class AddCompanySlug1780200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "slug" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${COMPANY_SLUG_UNIQUE}" ON "companies" ("slug")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${COMPANY_SLUG_UNIQUE}"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "slug"`);
  }
}
