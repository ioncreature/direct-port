import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Мультитенантность: таблица companies + денормализованный company_id на доменных
 * таблицах (users, telegram_users, documents, conversation_messages, ai_usage_log).
 *
 * Все существующие данные привязываются к одной дефолтной компании «По умолчанию»
 * (фиксированный UUID — чтобы бэкафилл и сид ссылались без подзапроса). Существующий
 * корневой админ admin@directport.ru становится глобальным super_admin (company_id = NULL).
 *
 * Инвариант на уровне БД (CHK_users_company_role): super_admin ⇔ company_id IS NULL,
 * остальные роли ⇔ company_id IS NOT NULL — добавляется ПОСЛЕ бэкафилла.
 */
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export class AddMultiTenancy1779200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Таблица компаний.
    await queryRunner.query(
      `CREATE TABLE "companies" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"name" character varying(255) NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_companies" PRIMARY KEY ("id"))`,
    );

    // 2. Дефолтная компания с фиксированным id.
    await queryRunner.query(`INSERT INTO "companies" ("id", "name") VALUES ($1, 'По умолчанию')`, [
      DEFAULT_COMPANY_ID,
    ]);

    // 3. users: колонка → бэкафилл → super_admin → FK (RESTRICT) → индекс.
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" uuid`);
    await queryRunner.query(`UPDATE "users" SET "company_id" = $1 WHERE "company_id" IS NULL`, [
      DEFAULT_COMPANY_ID,
    ]);
    await queryRunner.query(
      `UPDATE "users" SET "company_id" = NULL, "role" = 'super_admin' WHERE "email" = 'admin@directport.ru'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_users_company_id" ON "users" ("company_id")`);

    // 4. telegram_users: клиент может быть «ничей» → company_id остаётся nullable.
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD COLUMN IF NOT EXISTS "company_id" uuid`,
    );
    await queryRunner.query(`UPDATE "telegram_users" SET "company_id" = $1`, [DEFAULT_COMPANY_ID]);
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD CONSTRAINT "FK_telegram_users_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telegram_users_company_id" ON "telegram_users" ("company_id")`,
    );

    // 5. documents.
    await queryRunner.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "company_id" uuid`);
    await queryRunner.query(`UPDATE "documents" SET "company_id" = $1`, [DEFAULT_COMPANY_ID]);
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_company_id" ON "documents" ("company_id")`,
    );

    // 6. conversation_messages.
    await queryRunner.query(
      `ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "company_id" uuid`,
    );
    await queryRunner.query(`UPDATE "conversation_messages" SET "company_id" = $1`, [
      DEFAULT_COMPANY_ID,
    ]);
    await queryRunner.query(
      `ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_conversation_messages_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_messages_company_id" ON "conversation_messages" ("company_id")`,
    );

    // 7. ai_usage_log: company_id остаётся NULL (платформенные/кэш-разделяемые вызовы),
    //    бэкафилл не делаем.
    await queryRunner.query(
      `ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "company_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_usage_log" ADD CONSTRAINT "FK_ai_usage_log_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_usage_log_company_id" ON "ai_usage_log" ("company_id")`,
    );

    // 8. Инвариант роль ↔ компания (добавляем последним, после бэкафилла).
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_company_role" CHECK ` +
        `(("role" = 'super_admin' AND "company_id" IS NULL) OR ` +
        `("role" <> 'super_admin' AND "company_id" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_company_role"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_usage_log_company_id"`);
    await queryRunner.query(
      `ALTER TABLE "ai_usage_log" DROP CONSTRAINT IF EXISTS "FK_ai_usage_log_company"`,
    );
    await queryRunner.query(`ALTER TABLE "ai_usage_log" DROP COLUMN IF EXISTS "company_id"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversation_messages_company_id"`);
    await queryRunner.query(
      `ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "FK_conversation_messages_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "company_id"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_company_id"`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "FK_documents_company"`,
    );
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "company_id"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_telegram_users_company_id"`);
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "FK_telegram_users_company"`,
    );
    await queryRunner.query(`ALTER TABLE "telegram_users" DROP COLUMN IF EXISTS "company_id"`);

    // Роль 'super_admin' обратно в 'admin' не конвертируем (семантика потеряна); enum-значение
    // остаётся в типе (down миграции AddSuperAdminEnumValue — no-op).
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_company_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_company"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "company_id"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "companies"`);
  }
}
