import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Перенос депозита клиента на BillingAccount — владельца баланса и журнала операций.
 * Готовит почву под «компанию + несколько сотрудников» (1:N), сейчас связь 1:1.
 *
 *  - billing_accounts — новый владелец баланса (balance переезжает из telegram_users)
 *  - telegram_users.billing_account_id — связь на аккаунт (NOT NULL, 1:1)
 *  - deposit_transactions.billing_account_id — журнал переезжает с telegram_user_id на аккаунт
 *
 * Каждому существующему клиенту заводится по аккаунту с его текущим балансом и компанией.
 */
export class AddBillingAccount1779900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "balance" integer NOT NULL DEFAULT 0,
        "company_id" uuid REFERENCES "companies"("id"),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    // Связь на telegram_users — сначала nullable, заполняем бэкафиллом, затем NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN IF NOT EXISTS "billing_account_id" uuid`,
    );

    // По аккаунту на каждого клиента: переносим текущий баланс и компанию. Временная
    // колонка seed_telegram_user_id связывает созданный аккаунт с исходным клиентом.
    await queryRunner.query(
      `ALTER TABLE "billing_accounts" ADD COLUMN IF NOT EXISTS "seed_telegram_user_id" uuid`,
    );
    await queryRunner.query(`
      INSERT INTO "billing_accounts" ("balance", "company_id", "seed_telegram_user_id")
      SELECT tu."balance", tu."company_id", tu."id" FROM "telegram_users" tu
    `);
    await queryRunner.query(`
      UPDATE "telegram_users" tu
      SET "billing_account_id" = ba."id"
      FROM "billing_accounts" ba
      WHERE ba."seed_telegram_user_id" = tu."id"
    `);
    await queryRunner.query(`ALTER TABLE "billing_accounts" DROP COLUMN "seed_telegram_user_id"`);

    await queryRunner.query(
      `ALTER TABLE "telegram_users" ALTER COLUMN "billing_account_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "telegram_users"
      ADD CONSTRAINT "fk_telegram_users_billing_account"
      FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id")
    `);

    // Журнал операций переезжает на аккаунт.
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" ADD COLUMN IF NOT EXISTS "billing_account_id" uuid`,
    );
    await queryRunner.query(`
      UPDATE "deposit_transactions" dt
      SET "billing_account_id" = tu."billing_account_id"
      FROM "telegram_users" tu
      WHERE dt."telegram_user_id" = tu."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" ALTER COLUMN "billing_account_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "deposit_transactions"
      ADD CONSTRAINT "fk_deposit_tx_billing_account"
      FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_deposit_tx_user_created"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_deposit_tx_account_created" ON "deposit_transactions" ("billing_account_id", "created_at")`,
    );
    // FK telegram_user_id уходит вместе с колонкой (Postgres дропает зависимый constraint).
    await queryRunner.query(`ALTER TABLE "deposit_transactions" DROP COLUMN "telegram_user_id"`);

    // Баланс окончательно переехал в billing_accounts.
    await queryRunner.query(`ALTER TABLE "telegram_users" DROP COLUMN "balance"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возврат баланса на telegram_users (однозначно при связи 1:1).
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN IF NOT EXISTS "balance" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE "telegram_users" tu
      SET "balance" = ba."balance"
      FROM "billing_accounts" ba
      WHERE tu."billing_account_id" = ba."id"
    `);

    // Возврат журнала на telegram_user_id.
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" ADD COLUMN IF NOT EXISTS "telegram_user_id" uuid`,
    );
    await queryRunner.query(`
      UPDATE "deposit_transactions" dt
      SET "telegram_user_id" = tu."id"
      FROM "telegram_users" tu
      WHERE dt."billing_account_id" = tu."billing_account_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_deposit_tx_account_created"`);
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" DROP CONSTRAINT IF EXISTS "fk_deposit_tx_billing_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" DROP COLUMN IF EXISTS "billing_account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deposit_transactions" ALTER COLUMN "telegram_user_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "deposit_transactions"
      ADD CONSTRAINT "fk_deposit_tx_telegram_user"
      FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_deposit_tx_user_created" ON "deposit_transactions" ("telegram_user_id", "created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "fk_telegram_users_billing_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP COLUMN IF EXISTS "billing_account_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounts"`);
  }
}
