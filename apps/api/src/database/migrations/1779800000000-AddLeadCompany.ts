import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant-скоуп лидов: company_id на таблице leads (раньше лиды были платформенными,
 * см. AddLeads). Существующие лиды привязываются к компании «По умолчанию»
 * (фиксированный UUID из AddMultiTenancy). FK ON DELETE SET NULL — удаление компании
 * не блокируется, лид уходит в общий пул (виден только super_admin).
 */
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export class AddLeadCompany1779800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leads" ADD COLUMN "company_id" uuid`);
    await queryRunner.query(`UPDATE "leads" SET "company_id" = $1`, [DEFAULT_COMPANY_ID]);
    await queryRunner.query(
      `ALTER TABLE "leads" ADD CONSTRAINT "FK_leads_company" ` +
        `FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE INDEX "idx_leads_company_id" ON "leads" ("company_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_leads_company_id"`);
    await queryRunner.query(`ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "FK_leads_company"`);
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN IF EXISTS "company_id"`);
  }
}
