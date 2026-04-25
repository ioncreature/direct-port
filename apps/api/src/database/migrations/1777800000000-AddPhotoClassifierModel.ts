import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhotoClassifierModel1777800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_config ADD COLUMN photo_classifier_model VARCHAR(10) NOT NULL DEFAULT 'sonnet'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_config DROP COLUMN IF EXISTS photo_classifier_model`);
  }
}
