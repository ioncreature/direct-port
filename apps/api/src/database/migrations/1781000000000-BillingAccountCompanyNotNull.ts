import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Закрывает техдолг тенант-скоупа биллинга: `billing_accounts.company_id` становится
 * источником правды для скоупа по компании (вместо обхода через telegram_users).
 *
 * Поле проставляется при создании аккаунта (TelegramUsersService.register) и было
 * забэкафиллено миграцией AddBillingAccount; клиент не может сменить компанию (уникальность
 * пары (company_id, telegram_id), claim менеджером ограничен guard'ом той же компании),
 * поэтому значение не дрейфует. Добиваем возможные NULL'ы (аккаунты, созданные до бэкафилла
 * без связанного telegram_user) и фиксируем NOT NULL + индекс под агрегаты дашборда.
 */
const BILLING_COMPANY_IDX = 'IDX_billing_accounts_company';
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export class BillingAccountCompanyNotNull1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "billing_accounts" ba
         SET "company_id" = tu."company_id"
        FROM "telegram_users" tu
       WHERE tu."billing_account_id" = ba."id" AND ba."company_id" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "billing_accounts" SET "company_id" = '${DEFAULT_COMPANY_ID}' WHERE "company_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_accounts" ALTER COLUMN "company_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${BILLING_COMPANY_IDX}" ON "billing_accounts" ("company_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${BILLING_COMPANY_IDX}"`);
    await queryRunner.query(
      `ALTER TABLE "billing_accounts" ALTER COLUMN "company_id" DROP NOT NULL`,
    );
    // Бэкафилл данных не откатываем: заполненный company_id корректен и при nullable-колонке.
  }
}
