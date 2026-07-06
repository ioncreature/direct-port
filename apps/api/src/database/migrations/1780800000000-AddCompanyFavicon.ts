import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Favicon тенанта: компания может загрузить свою иконку вкладки браузера (super_admin), она
 * заменяет дефолтный favicon DirectPort в admin-web. Хранится в companies рядом с логотипом
 * (1 favicon на компанию): favicon_bytes select:false, favicon_mime (image/png|image/svg+xml),
 * favicon_hash (sha256 — ETag + cache-busting). NULL — своего favicon нет.
 */
export class AddCompanyFavicon1780800000000 implements MigrationInterface {
  name = 'AddCompanyFavicon1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD COLUMN "favicon_bytes" bytea,
        ADD COLUMN "favicon_mime" varchar(32),
        ADD COLUMN "favicon_hash" varchar(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN "favicon_hash",
        DROP COLUMN "favicon_mime",
        DROP COLUMN "favicon_bytes"
    `);
  }
}
