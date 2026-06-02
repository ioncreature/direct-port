import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Привязка менеджерского Telegram к User (manager_telegram_id, уникален среди заполненных)
 * и закрепление клиента за менеджером (telegram_users.assigned_manager_id — claim).
 */
export class AddManagerLinkAndAssignment1778800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_telegram_id" bigint`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_manager_telegram_id" ON "users" ("manager_telegram_id") WHERE "manager_telegram_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN IF NOT EXISTS "assigned_manager_id" uuid REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP COLUMN IF EXISTS "assigned_manager_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_manager_telegram_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "manager_telegram_id"`);
  }
}
