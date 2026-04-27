import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Постоянная SQL-функция `model_family(text)` — сворачивает любой model ID
 * Claude в семейство (haiku/sonnet/opus). Используется в запросах статистики
 * `documents.service.ts` для устойчивой группировки/фильтрации, чтобы
 * /ai-costs не показывал дубликаты «Claude Haiku/Opus» при смешанных
 * данных в БД (например, translate-вызовы успели записать «claude-haiku-4-5-20251001»
 * между миграцией NormalizeModelFamilies и передеплоем API на новый код).
 *
 * Также повторно прогоняем UPDATE по плоским колонкам и JSONB token_usage —
 * на случай если за период «миграция применена, но pod ещё не перезапущен»
 * приложение успело записать пред-нормализационный формат.
 */
export class AddModelFamilyFunction1778100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION model_family(m text) RETURNS text AS $$
        SELECT CASE
          WHEN m IS NULL THEN NULL
          WHEN m ILIKE '%haiku%' THEN 'haiku'
          WHEN m ILIKE '%sonnet%' THEN 'sonnet'
          WHEN m ILIKE '%opus%' THEN 'opus'
          ELSE m
        END
      $$ LANGUAGE SQL IMMUTABLE;
    `);

    await queryRunner.query(
      `UPDATE ai_usage_log SET model = model_family(model) WHERE model_family(model) <> model`,
    );

    await queryRunner.query(
      `UPDATE ai_call SET model = model_family(model) WHERE model_family(model) <> model`,
    );

    await queryRunner.query(`
      UPDATE documents
      SET token_usage = (
        SELECT jsonb_object_agg(stage_key, normalized_models)
        FROM (
          SELECT s.key AS stage_key,
                 (
                   SELECT jsonb_object_agg(family, summed)
                   FROM (
                     SELECT model_family(m.key) AS family,
                            jsonb_build_object(
                              'inputTokens', SUM(COALESCE((m.value->>'inputTokens')::bigint, 0)),
                              'outputTokens', SUM(COALESCE((m.value->>'outputTokens')::bigint, 0)),
                              'cacheCreationTokens', SUM(COALESCE((m.value->>'cacheCreationTokens')::bigint, 0)),
                              'cacheReadTokens', SUM(COALESCE((m.value->>'cacheReadTokens')::bigint, 0))
                            ) AS summed
                     FROM jsonb_each(s.value) m
                     GROUP BY model_family(m.key)
                   ) inner_agg
                 ) AS normalized_models
          FROM jsonb_each(documents.token_usage) s
        ) stages
      )
      WHERE token_usage IS NOT NULL AND token_usage <> '{}'::jsonb
    `);

    await queryRunner.query(`
      UPDATE pipeline_stage_run
      SET token_usage = (
        SELECT jsonb_object_agg(family, summed)
        FROM (
          SELECT model_family(m.key) AS family,
                 jsonb_build_object(
                   'inputTokens', SUM(COALESCE((m.value->>'inputTokens')::bigint, 0)),
                   'outputTokens', SUM(COALESCE((m.value->>'outputTokens')::bigint, 0)),
                   'cacheCreationTokens', SUM(COALESCE((m.value->>'cacheCreationTokens')::bigint, 0)),
                   'cacheReadTokens', SUM(COALESCE((m.value->>'cacheReadTokens')::bigint, 0))
                 ) AS summed
          FROM jsonb_each(pipeline_stage_run.token_usage) m
          GROUP BY model_family(m.key)
        ) sub
      )
      WHERE token_usage IS NOT NULL AND token_usage <> '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS model_family(text)`);
  }
}
