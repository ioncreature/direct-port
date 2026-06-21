import { MigrationInterface, QueryRunner } from 'typeorm';

/** Журнал web-поисков лидов (история discovery-заданий). */
export class AddLeadSearches1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lead_searches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "query" character varying(200) NOT NULL,
        "city" character varying(120),
        "max_results" integer NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'running',
        "found_count" integer NOT NULL DEFAULT 0,
        "created_count" integer NOT NULL DEFAULT 0,
        "skipped_count" integer NOT NULL DEFAULT 0,
        "error_message" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_lead_searches" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_lead_searches_created_at" ON "lead_searches" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_lead_searches_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lead_searches"`);
  }
}
