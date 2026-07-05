import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSendResultFile1780400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Флаг `send_result_file` больше не читается кодом: отправку результата в Telegram
    // решает PipelineNotifierService по source/status документа, а не эта настройка.
    await queryRunner.query(
      `ALTER TABLE "calculation_config" DROP COLUMN IF EXISTS "send_result_file"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возвращаем колонку в исходном виде (см. AddSendResultFile1776800000000) —
    // только ради ревёрсности схемы; кодом она по-прежнему не используется.
    await queryRunner.query(
      `ALTER TABLE "calculation_config" ADD "send_result_file" boolean NOT NULL DEFAULT true`,
    );
  }
}
