import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCommissionColumns1780500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Легаси-формула «комиссии за доставку» (price_percent/weight_rate/fixed_fee)
    // удалена: биллинг перешёл на модель $1/позиция (кредиты), а колонки больше
    // не читаются кодом — logisticsCommission исключён из расчёта и вывода.
    await queryRunner.query(
      `ALTER TABLE "calculation_config"
         DROP COLUMN IF EXISTS "price_percent",
         DROP COLUMN IF EXISTS "weight_rate",
         DROP COLUMN IF EXISTS "fixed_fee"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возвращаем колонки в исходном виде (см. AddCalculationConfig1775600000000) —
    // только ради ревёрсности схемы; кодом они по-прежнему не используются.
    await queryRunner.query(
      `ALTER TABLE "calculation_config"
         ADD COLUMN "price_percent" DECIMAL(8,4) NOT NULL DEFAULT 5,
         ADD COLUMN "weight_rate" DECIMAL(10,4) NOT NULL DEFAULT 0,
         ADD COLUMN "fixed_fee" DECIMAL(10,2) NOT NULL DEFAULT 0`,
    );
  }
}
