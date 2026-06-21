import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales-воронка: таблица leads (потенциальные клиенты-импортёры).
 *
 * Лиды — платформенная сущность владельца DirectPort (не данные тенанта),
 * поэтому без company_id: доступ — admin/customs/super_admin.
 */
export class AddLeads1779300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."leads_status_enum" AS ENUM(` +
        `'new', 'enriching', 'enriched', 'in_progress', 'contacted', 'qualified', 'rejected', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "company_name" character varying(500) NOT NULL,
        "website" character varying(500),
        "domain" character varying(255),
        "inn" character varying(12),
        "city" character varying(255),
        "phones" jsonb,
        "emails" jsonb,
        "services" jsonb,
        "does_import" boolean,
        "import_directions" jsonb,
        "relevance_score" numeric(3,2),
        "relevance_reason" text,
        "status" "public"."leads_status_enum" NOT NULL DEFAULT 'new',
        "source" character varying(20) NOT NULL,
        "source_detail" character varying(500),
        "notes" text,
        "last_contacted_at" TIMESTAMP WITH TIME ZONE,
        "error_message" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leads" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_leads_status" ON "leads" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_leads_domain" ON "leads" ("domain")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_leads_domain"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_leads_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leads"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."leads_status_enum"`);
  }
}
