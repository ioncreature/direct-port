import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSendResultFile1776800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calculation_config" ADD "send_result_file" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calculation_config" DROP COLUMN "send_result_file"`,
    );
  }
}
