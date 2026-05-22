import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Удаляет из `duty_interpretation_cache` интерпретации, где AI вернул более
 * одного charge type='vat'. Такие записи приводили к удвоению/утроению НДС
 * в расчётах: каждый vat-charge суммируется в Calculator, а льготные ставки
 * 10%/0% (медизделия, детские товары, школьные принадлежности, книги, ТСР
 * инвалидов) AI ошибочно кодировал как ОТДЕЛЬНЫЕ charges по аналогии с
 * акцизами из TNVEDALL[2].
 *
 * После фикса (collapseVatCharges в Calculator + правило 8a в SYSTEM_PROMPT
 * duty-interpreter) новые интерпретации генерируются корректно, но уже
 * закэшированные ответы остались с дубликатами — их нужно сбросить, чтобы
 * следующий запрос регенерировал интерпретацию заново.
 *
 * Down: no-op — нет смысла «возвращать» битые записи; TTL кэша 180 дней,
 * перегенерация запрашивается лениво при первом обращении к коду.
 */
export class PurgeMultiVatInterpretations1778400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Guard `jsonb_typeof = 'array'`: если в кэше окажется строка с charges
    // не-массивом (legacy/corruption), jsonb_array_elements бросит
    // 'cannot extract elements from a scalar/object', что положит миграцию
    // и весь старт API (migrationsRun: true). Защищаемся проверкой типа.
    await queryRunner.query(`
      DELETE FROM duty_interpretation_cache
      WHERE jsonb_typeof(interpretation->'charges') = 'array'
        AND (
          SELECT count(*)
            FROM jsonb_array_elements(interpretation->'charges') c
           WHERE c->>'type' = 'vat'
        ) > 1
    `);
  }

  public async down(): Promise<void> {
    // no-op: восстановить удалённые ответы Claude невозможно, перегенерация безопасна.
  }
}
