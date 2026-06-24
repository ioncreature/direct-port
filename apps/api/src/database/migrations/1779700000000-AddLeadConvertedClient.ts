import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Привязка лида к клиенту: лид, написавший в бот, становится telegram-пользователем.
 * converted_telegram_user_id → telegram_users, ON DELETE SET NULL (удаление клиента
 * не блокируется и не оставляет висячий FK — лид просто «расконвертируется»).
 *
 * Лиды платформенные (без company_id), клиенты тенантские. Для одного провайдера это
 * корректно; tenant-скоуп самой привязки появится вместе со скоупом лидов.
 */
export class AddLeadConvertedClient1779700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leads" ADD COLUMN "converted_telegram_user_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "leads" ADD COLUMN "converted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "leads" ADD CONSTRAINT "FK_leads_converted_client" ` +
        `FOREIGN KEY ("converted_telegram_user_id") REFERENCES "telegram_users"("id") ` +
        `ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_leads_converted_client" ON "leads" ("converted_telegram_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_leads_converted_client"`);
    await queryRunner.query(
      `ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "FK_leads_converted_client"`,
    );
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN IF EXISTS "converted_at"`);
    await queryRunner.query(
      `ALTER TABLE "leads" DROP COLUMN IF EXISTS "converted_telegram_user_id"`,
    );
  }
}
