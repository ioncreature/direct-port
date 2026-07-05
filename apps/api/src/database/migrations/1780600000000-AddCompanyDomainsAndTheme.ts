import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Компания как полноценный тенант: доменные имена + тема оформления.
 *
 *  1. companies.theme — палитра админки под тенанта (см. common/tenant/company-theme.ts).
 *     NOT NULL, дефолт 'default' (базовая тема платформы). Существующие компании получают дефолт.
 *
 *  2. company_domains — домены тенанта (0..N на компанию). По домену входящего запроса admin-web
 *     резолвит компанию: подбирает тему и гейтит вход (пользователь должен принадлежать тенанту).
 *       - domain UNIQUE глобально: один домен не принадлежит двум компаниям;
 *       - FK company_id → companies ON DELETE CASCADE: домены живут ровно пока жива компания;
 *       - индекс по company_id для выборки доменов компании.
 */
const COMPANY_DOMAINS_DOMAIN_UNIQUE = 'UQ_company_domains_domain';
const COMPANY_DOMAINS_COMPANY_IDX = 'IDX_company_domains_company_id';
const COMPANY_DOMAINS_COMPANY_FK = 'FK_company_domains_company';

export class AddCompanyDomainsAndTheme1780600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "theme" character varying(32) NOT NULL DEFAULT 'default'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "company_domains" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "company_id" uuid NOT NULL,
         "domain" character varying(255) NOT NULL,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_company_domains" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${COMPANY_DOMAINS_DOMAIN_UNIQUE}" ON "company_domains" ("domain")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${COMPANY_DOMAINS_COMPANY_IDX}" ON "company_domains" ("company_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_domains" DROP CONSTRAINT IF EXISTS "${COMPANY_DOMAINS_COMPANY_FK}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_domains" ADD CONSTRAINT "${COMPANY_DOMAINS_COMPANY_FK}" ` +
        `FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "company_domains"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "theme"`);
  }
}
