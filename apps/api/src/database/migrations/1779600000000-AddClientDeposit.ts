import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Модель депозита клиента: баланс в «обработанных позициях».
 *  - telegram_users.balance — текущий баланс клиента (денормализованный счётчик)
 *  - documents.balance_charged_amount — сколько позиций уже списано за документ (идемпотентность)
 *  - deposit_transactions — журнал операций (пополнения/списания/корректировки)
 *
 * Менеджер пополняет баланс вручную после оплаты вне системы; успешная обработка
 * документа списывает по 1 за каждую успешно посчитанную позицию.
 */
export class AddClientDeposit1779600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN IF NOT EXISTS "balance" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "balance_charged_amount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deposit_transactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "telegram_user_id" uuid NOT NULL REFERENCES "telegram_users"("id") ON DELETE CASCADE,
        "delta" integer NOT NULL,
        "type" varchar(16) NOT NULL,
        "balance_after" integer NOT NULL,
        "document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
        "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "comment" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_deposit_tx_user_created" ON "deposit_transactions" ("telegram_user_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_deposit_tx_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "deposit_transactions"`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN IF EXISTS "balance_charged_amount"`,
    );
    await queryRunner.query(`ALTER TABLE "telegram_users" DROP COLUMN IF EXISTS "balance"`);
  }
}
