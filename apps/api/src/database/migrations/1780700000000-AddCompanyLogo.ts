import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Логотип тенанта: компания-тенант может загрузить свой логотип (super_admin), он заменяет
 * марку DirectPort в шапке и на странице входа admin-web. Байты хранятся в самой companies
 * (1 логотип на компанию) — logo_bytes select:false, чтобы не тянуться в обычные выборки;
 * logo_mime — тип (image/png или image/svg+xml), logo_hash — sha256 финальных байт (ETag +
 * cache-busting в URL). NULL во всех трёх — логотипа нет, показывается дефолтная марка.
 */
export class AddCompanyLogo1780700000000 implements MigrationInterface {
  name = 'AddCompanyLogo1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD COLUMN "logo_bytes" bytea,
        ADD COLUMN "logo_mime" varchar(32),
        ADD COLUMN "logo_hash" varchar(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN "logo_hash",
        DROP COLUMN "logo_mime",
        DROP COLUMN "logo_bytes"
    `);
  }
}
