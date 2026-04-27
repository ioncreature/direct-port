import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Сворачивает все хранимые имена моделей Claude к семейству (haiku/sonnet/opus).
 *
 * До миграции в БД встречались разные форматы конкретных версий: «claude-haiku-4-5»,
 * «claude-haiku-4-5-20251001», «claude-sonnet-4-6», «claude-sonnet-4-20250514»,
 * «claude-opus-4-7» и т. п. Для аналитики стоимости и UX (фильтр на /ai-costs)
 * важно семейство, а не точечная ревизия — она меняется по нескольку раз в год,
 * раздувает список фильтра и ломает сводку при апгрейде. Конкретная версия
 * для вызова Anthropic SDK живёт в AiConfigService.MODEL_IDS и в `request`
 * audit-записи AiCall — она не теряется.
 *
 * Затронутые места:
 *   - ai_usage_log.model               (varchar)
 *   - ai_call.model                    (varchar)
 *   - documents.token_usage            (jsonb { stage: { model: usage } })
 *   - pipeline_stage_run.token_usage   (jsonb { model: usage })
 *   - duty_interpretation_cache       (PK содержит model — переименование
 *     ломает PK; кэш можно перестроить, поэтому очищаем)
 *
 * Down не реализован: восстановить точные version-суффиксы из «sonnet»
 * невозможно (они объединены и слиты).
 */
export class NormalizeModelFamilies1778000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pg_temp_model_family(m text) RETURNS text AS $$
      BEGIN
        IF m IS NULL THEN RETURN NULL; END IF;
        IF m ILIKE '%haiku%' THEN RETURN 'haiku'; END IF;
        IF m ILIKE '%sonnet%' THEN RETURN 'sonnet'; END IF;
        IF m ILIKE '%opus%' THEN RETURN 'opus'; END IF;
        RETURN m;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await queryRunner.query(
      `UPDATE ai_usage_log SET model = pg_temp_model_family(model) WHERE pg_temp_model_family(model) <> model`,
    );

    await queryRunner.query(
      `UPDATE ai_call SET model = pg_temp_model_family(model) WHERE pg_temp_model_family(model) <> model`,
    );

    // documents.token_usage — двухуровневый JSONB { stage: { model: usage } }.
    // Внутри каждого stage переименовываем ключи моделей в семейство, при этом
    // дубликаты (например, sonnet-4-6 и sonnet-4-20250514 в одном stage)
    // суммируются.
    await queryRunner.query(`
      UPDATE documents
      SET token_usage = (
        SELECT jsonb_object_agg(stage_key, normalized_models)
        FROM (
          SELECT s.key AS stage_key,
                 (
                   SELECT jsonb_object_agg(family, summed)
                   FROM (
                     SELECT pg_temp_model_family(m.key) AS family,
                            jsonb_build_object(
                              'inputTokens', SUM(COALESCE((m.value->>'inputTokens')::bigint, 0)),
                              'outputTokens', SUM(COALESCE((m.value->>'outputTokens')::bigint, 0)),
                              'cacheCreationTokens', SUM(COALESCE((m.value->>'cacheCreationTokens')::bigint, 0)),
                              'cacheReadTokens', SUM(COALESCE((m.value->>'cacheReadTokens')::bigint, 0))
                            ) AS summed
                     FROM jsonb_each(s.value) m
                     GROUP BY pg_temp_model_family(m.key)
                   ) inner_agg
                 ) AS normalized_models
          FROM jsonb_each(documents.token_usage) s
        ) stages
      )
      WHERE token_usage IS NOT NULL AND token_usage <> '{}'::jsonb
    `);

    // pipeline_stage_run.token_usage — одноуровневый JSONB { model: usage }.
    await queryRunner.query(`
      UPDATE pipeline_stage_run
      SET token_usage = (
        SELECT jsonb_object_agg(family, summed)
        FROM (
          SELECT pg_temp_model_family(m.key) AS family,
                 jsonb_build_object(
                   'inputTokens', SUM(COALESCE((m.value->>'inputTokens')::bigint, 0)),
                   'outputTokens', SUM(COALESCE((m.value->>'outputTokens')::bigint, 0)),
                   'cacheCreationTokens', SUM(COALESCE((m.value->>'cacheCreationTokens')::bigint, 0)),
                   'cacheReadTokens', SUM(COALESCE((m.value->>'cacheReadTokens')::bigint, 0))
                 ) AS summed
          FROM jsonb_each(pipeline_stage_run.token_usage) m
          GROUP BY pg_temp_model_family(m.key)
        ) sub
      )
      WHERE token_usage IS NOT NULL AND token_usage <> '{}'::jsonb
    `);

    // duty_interpretation_cache: model входит в составной первичный ключ.
    // Переименование model породит дубликаты (interp(opus-4-7) и interp(opus-4-1)
    // → оба станут opus). Не пытаемся слить интерпретации — их безопасно
    // перестроить заново (180 дней TTL в любом случае подразумевает refresh).
    await queryRunner.query(`TRUNCATE TABLE duty_interpretation_cache`);

    await queryRunner.query(`DROP FUNCTION pg_temp_model_family(text)`);
  }

  public async down(): Promise<void> {
    // no-op: невозможно восстановить точную версию модели после слияния семейств.
  }
}
