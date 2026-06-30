import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Фундамент под «боты для каждой компании» (см. docs/COMPANY_BOTS.md):
 *
 *  1. companies — зашифрованные токены и кэш username клиентского и менеджерского ботов
 *     компании. NULL = у компании нет своего бота, обслуживается дефолтным ботом платформы.
 *
 *  2. telegram_users — клиент становится парой (company_id, telegram_id): один человек может
 *     быть клиентом нескольких компаний независимо (свой баланс/история в каждой).
 *       - company_id: бэкафилл оставшихся NULL (общий пул) в дефолтную компанию → NOT NULL;
 *       - глобальный UNIQUE(telegram_id) снимается, ставится композитный UNIQUE(company_id,
 *         telegram_id);
 *       - FK company_id: ON DELETE SET NULL → RESTRICT (SET NULL противоречил бы NOT NULL;
 *         компанию с клиентами удалять нельзя).
 *     Индекс IDX_88256a651008c00c1eea23e0b6 на telegram_id оставляем — поиск по telegram_id
 *     ещё нужен (резолв клиента, менеджерские привязки).
 *
 * Поведенческих изменений нет: токены ещё никем не читаются, резолв клиента по паре включается
 * в следующих фазах.
 */
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const LEGACY_TELEGRAM_ID_UNIQUE = 'UQ_88256a651008c00c1eea23e0b61';
const COMPANY_TELEGRAM_UNIQUE = 'UQ_telegram_users_company_telegram';

export class AddCompanyBotsFoundation1780100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Токены ботов компании. token_enc — select:false на уровне entity, чтобы не утекали в
    //    ответы API; здесь это обычные nullable-колонки.
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "client_bot_token_enc" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "client_bot_username" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "manager_bot_token_enc" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "manager_bot_username" character varying(255)`,
    );

    // 2. telegram_users → пара (company_id, telegram_id).
    await queryRunner.query(`UPDATE "telegram_users" SET "company_id" = $1 WHERE "company_id" IS NULL`, [
      DEFAULT_COMPANY_ID,
    ]);
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "${LEGACY_TELEGRAM_ID_UNIQUE}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ALTER COLUMN "company_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "FK_telegram_users_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD CONSTRAINT "FK_telegram_users_company" ` +
        `FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD CONSTRAINT "${COMPANY_TELEGRAM_UNIQUE}" ` +
        `UNIQUE ("company_id", "telegram_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возврат telegram_users к глобальной уникальности telegram_id. Если к этому моменту один
    // человек уже заведён в нескольких компаниях, re-add UNIQUE(telegram_id) упадёт на дублях —
    // это осознанно (down рассчитан на откат до появления таких клиентов).
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "${COMPANY_TELEGRAM_UNIQUE}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" DROP CONSTRAINT IF EXISTS "FK_telegram_users_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD CONSTRAINT "FK_telegram_users_company" ` +
        `FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ALTER COLUMN "company_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "telegram_users" ADD CONSTRAINT "${LEGACY_TELEGRAM_ID_UNIQUE}" UNIQUE ("telegram_id")`,
    );

    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "manager_bot_username"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "manager_bot_token_enc"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "client_bot_username"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "client_bot_token_enc"`);
  }
}
