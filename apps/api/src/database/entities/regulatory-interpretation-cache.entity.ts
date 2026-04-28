import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import type { RegulatoryExplanation } from '../../regulatory/interfaces';

/**
 * Persistent cache AI-выжимок разрешительных мер. Ключ — (noteHash, language, model):
 * - noteHash = sha256 от `RegulatoryItem.rawNote`. Текст NOTE из TKS меняется редко
 *   (новые редакции ТР ТС/ПП РФ — раз в несколько месяцев), кэш живёт 180 дней.
 * - language нужен потому что summary локализуется (ru/en/zh).
 * - model — семейство (haiku/sonnet/opus) — смена модели в AiConfig инвалидирует
 *   старые записи только для новой модели; старые остаются доступны прежним пользователям.
 *
 * Без этого кэша каждый просмотр кода ТН ВЭД с N разрешительными записями давал бы
 * N запросов в Claude — недопустимо для UI справочника.
 */
@Entity('regulatory_interpretation_cache')
export class RegulatoryInterpretationCache {
  @PrimaryColumn({ name: 'note_hash', type: 'varchar', length: 64 })
  noteHash: string;

  @PrimaryColumn({ type: 'varchar', length: 10 })
  language: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'jsonb' })
  explanation: RegulatoryExplanation;

  @Index()
  @Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
  fetchedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
