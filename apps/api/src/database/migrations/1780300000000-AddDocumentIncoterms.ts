import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Условия поставки Инкотермс 2020 на документе. Без них структура таможенной
 * стоимости неоднозначна: при CIF/CFR/DAP перевозка уже оплачена продавцом и
 * дополнительный фрахт задваивал бы стоимость, при EXW/FOB фрахт обязателен —
 * иначе стоимость занижена. Pipeline использует поле для warning-заметок.
 * Колонка nullable: документы без указанных условий — норма (текущее поведение).
 */
export class AddDocumentIncoterms1780300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "incoterms" character varying(3)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "incoterms"`);
  }
}
