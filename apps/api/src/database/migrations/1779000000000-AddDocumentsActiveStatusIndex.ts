import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Частичный индекс под StuckDocumentsWatchdog: его sweep раз в 10 минут с каждой
 * реплики API делает `... WHERE status IN ('parsing','pending','processing') AND
 * updated_at < cutoff`. Активные статусы транзиентны, поэтому индекс почти пустой,
 * а sweep становится O(застрявших) вместо seq scan всей таблицы документов
 * (которая растёт с историей). Колонка updated_at в индексе закрывает предикат
 * по времени целиком.
 *
 * ИНВАРИАНТ: список статусов в предикате ниже обязан совпадать с `ACTIVE_STATUSES`
 * в stuck-documents.watchdog.ts. Добавили активный статус в watchdog — добавьте
 * новую миграцию, расширяющую этот предикат, иначе sweep по новому статусу молча
 * перестанет пользоваться индексом.
 */
export class AddDocumentsActiveStatusIndex1779000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_documents_active_status_updated_at" ` +
        `ON "documents" ("updated_at") ` +
        `WHERE "status" IN ('parsing', 'pending', 'processing')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_active_status_updated_at"`);
  }
}
