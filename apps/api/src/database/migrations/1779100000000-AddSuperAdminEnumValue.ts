import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Добавляет значение 'super_admin' в enum роли пользователя (users_role_enum).
 *
 * Выделено в отдельную миграцию намеренно: PostgreSQL не позволяет ИСПОЛЬЗОВАТЬ новое
 * значение enum в той же транзакции, где оно объявлено, а TypeORM оборачивает каждую
 * миграцию в транзакцию. Бэкафилл существующего админа в роль 'super_admin' выполняется
 * в следующей миграции (AddMultiTenancy), которая идёт уже отдельной транзакцией.
 */
export class AddSuperAdminEnumValue1779100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'super_admin'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL не умеет удалять значение из enum-типа. Откат — no-op: значение
    // 'super_admin' остаётся в типе (безвредно, пока не используется в данных).
  }
}
