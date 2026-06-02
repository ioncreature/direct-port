import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Managed-флоу: новый статус документа INTAKE (получен, ждёт ручного запуска менеджером)
 * и поле source ('self_service' | 'managed'). Legacy-документы остаются self_service.
 */
export class AddManagedIntake1778700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "documents_status_enum" ADD VALUE IF NOT EXISTS 'intake'`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'self_service'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "source"`);
    // PostgreSQL не поддерживает удаление значения enum — 'intake' остаётся в типе.
  }
}
