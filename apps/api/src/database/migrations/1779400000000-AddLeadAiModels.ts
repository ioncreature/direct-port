import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поля выбора моделей Claude для AI-сценариев лидгена:
 * lead_discovery_model (web-поиск компаний) и lead_enrichment_model (скоринг сайта).
 */
export class AddLeadAiModels1779400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "lead_discovery_model" varchar(10) NOT NULL DEFAULT 'sonnet'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "lead_enrichment_model" varchar(10) NOT NULL DEFAULT 'haiku'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_config" DROP COLUMN IF EXISTS "lead_enrichment_model"`);
    await queryRunner.query(`ALTER TABLE "ai_config" DROP COLUMN IF EXISTS "lead_discovery_model"`);
  }
}
