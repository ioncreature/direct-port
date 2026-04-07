import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminDocumentUpload1775800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ALTER COLUMN "telegram_user_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "uploaded_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "documents" WHERE "telegram_user_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "documents" ALTER COLUMN "telegram_user_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "uploaded_by_user_id"`);
  }
}
