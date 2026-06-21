import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Статус задания discovery. */
export type LeadSearchStatus = 'running' | 'completed' | 'failed';

/**
 * Журнал проведённых web-поисков лидов. Пишется на запуск discovery (running)
 * и обновляется воркером по завершении (completed/failed + счётчики). Нужен,
 * чтобы видеть историю запросов — включая пустые и упавшие, которые по самим
 * лидам не восстановить.
 */
@Entity('lead_searches')
@Index('idx_lead_searches_created_at', ['createdAt'])
export class LeadSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  query: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'int', name: 'max_results' })
  maxResults: number;

  @Column({ type: 'varchar', length: 12, default: 'running' })
  status: LeadSearchStatus;

  /** Сколько компаний нашёл Claude. */
  @Column({ type: 'int', name: 'found_count', default: 0 })
  foundCount: number;

  /** Сколько новых лидов создано (после дедупа). */
  @Column({ type: 'int', name: 'created_count', default: 0 })
  createdCount: number;

  /** Сколько отброшено как дубли. */
  @Column({ type: 'int', name: 'skipped_count', default: 0 })
  skippedCount: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;
}
