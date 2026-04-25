import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import type { DutyInterpretation } from '../../duty-interpreter/interfaces';

/**
 * Persistent cache интерпретаций пошлин Claude. Правила пошлин ТН ВЭД меняются
 * редко (новые решения ЕЭК — раз в несколько месяцев), поэтому хранить ответ
 * Claude можно долго (180 дней). Без этого кэша interpreter каждый раз заново
 * перегоняет известные коды через Claude после рестарта пода или между
 * репликами.
 *
 * Ключ — (tnvedCode, language, model). language нужен потому что Claude
 * добавляет reasoningLocalized для не-ru пользователей; model — потому что
 * смена interpreter-модели в AiConfig может изменить качество интерпретации,
 * и старые записи лучше переиспользовать только для той же модели.
 */
@Entity('duty_interpretation_cache')
export class DutyInterpretationCache {
  @PrimaryColumn({ name: 'tnved_code', type: 'varchar', length: 10 })
  tnvedCode: string;

  @PrimaryColumn({ type: 'varchar', length: 10 })
  language: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'jsonb' })
  interpretation: DutyInterpretation;

  @Index()
  @Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
  fetchedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
