import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Параметризация discovery-агента лидов компанией: журнал поисков получает company_id,
 * чтобы агент «не повторялся» только в рамках своей компании, а не по всей платформе.
 *
 * Существующие записи бэкафиллятся дефолтной компанией — до параметризации агент
 * (основной писатель журнала) искал только для неё. NULL остаётся допустимым: это
 * интерактивный discovery super_admin без выбранной компании (лиды в общий пул).
 */
const LEAD_SEARCH_COMPANY_IDX = 'idx_lead_searches_company';
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export class AddLeadSearchCompany1781100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lead_searches" ADD COLUMN IF NOT EXISTS "company_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "lead_searches" SET "company_id" = '${DEFAULT_COMPANY_ID}' WHERE "company_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${LEAD_SEARCH_COMPANY_IDX}" ON "lead_searches" ("company_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${LEAD_SEARCH_COMPANY_IDX}"`);
    await queryRunner.query(`ALTER TABLE "lead_searches" DROP COLUMN IF EXISTS "company_id"`);
  }
}
