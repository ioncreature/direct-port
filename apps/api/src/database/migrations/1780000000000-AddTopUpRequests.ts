import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Денежный слой кабинета (Ф2 — пополнение). Заявка на пополнение баланса:
 *  - top_up_requests — заявки (pending/confirmed/canceled) с зафиксированными
 *    деньгами (сумма/валюта/цена за позицию) на момент создания
 *  - deposit_transactions.source_request_id — связь topup-операции с заявкой;
 *    уникален (где не NULL) → подтверждение заявки идемпотентно (один topup на заявку)
 */
export class AddTopUpRequests1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "top_up_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "billing_account_id" uuid NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
        "created_by_telegram_user_id" uuid NOT NULL REFERENCES "telegram_users"("id") ON DELETE CASCADE,
        "package_key" varchar(32),
        "positions" integer NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "price_per_position" numeric(10,4) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "confirmed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "confirmed_at" TIMESTAMP WITH TIME ZONE,
        "comment" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_top_up_requests_account_created" ON "top_up_requests" ("billing_account_id", "created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" ADD COLUMN IF NOT EXISTS "source_request_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "deposit_transactions"
      ADD CONSTRAINT "fk_deposit_tx_source_request"
      FOREIGN KEY ("source_request_id") REFERENCES "top_up_requests"("id") ON DELETE SET NULL
    `);
    // Один topup на заявку: уникальность по source_request_id там, где он задан.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_deposit_tx_source_request" ON "deposit_transactions" ("source_request_id") WHERE "source_request_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_deposit_tx_source_request"`);
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" DROP CONSTRAINT IF EXISTS "fk_deposit_tx_source_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" DROP COLUMN IF EXISTS "source_request_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_top_up_requests_account_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "top_up_requests"`);
  }
}
