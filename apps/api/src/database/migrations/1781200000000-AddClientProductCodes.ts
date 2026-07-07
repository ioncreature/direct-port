import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Каталог подтверждённых кодов ТН ВЭД клиента (см. entity ClientProductCode):
 * память об ассортименте клиента, чтобы повторные поставки миновали AI-классификацию
 * и коды не расходились между расчётами. Уникальность — (company_id, telegram_user_id,
 * product_key); отдельный индекс по (company_id, telegram_user_id) не нужен — его
 * покрывает префикс уникального.
 */
const UQ_KEY = 'uq_client_product_codes_key';

export class AddClientProductCodes1781200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_product_codes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id"),
        "telegram_user_id" uuid NOT NULL REFERENCES "telegram_users"("id") ON DELETE CASCADE,
        "product_key" character varying(64) NOT NULL,
        "description" text NOT NULL,
        "article" character varying(255),
        "tn_ved_code" character varying(20) NOT NULL,
        "source" character varying(12) NOT NULL,
        "match_confidence" double precision NOT NULL,
        "times_used" integer NOT NULL DEFAULT 0,
        "last_used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${UQ_KEY}"
         ON "client_product_codes" ("company_id", "telegram_user_id", "product_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_product_codes"`);
  }
}
