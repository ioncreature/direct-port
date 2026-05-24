import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Гарантия консистентности пары (freight_cost, freight_currency) на уровне БД:
 *  - оба NULL → фрахта нет;
 *  - cost > 0 + currency ∈ {USD, CNY, RUB, EUR} → фрахт задан.
 * Ловит случаи, когда какой-нибудь сторонний инструмент или будущий код обходит
 * `normalizeFreightInput` и пишет половинное состояние напрямую через SQL/ORM.
 */
export class AddDocumentFreightCheck1778600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "documents_freight_pair_consistent" ` +
        `CHECK ((freight_cost IS NULL AND freight_currency IS NULL) OR ` +
        `(freight_cost > 0 AND freight_currency IN ('USD', 'CNY', 'RUB', 'EUR')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_freight_pair_consistent"`,
    );
  }
}
