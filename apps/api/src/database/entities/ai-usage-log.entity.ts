import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ai_usage_log')
export class AiUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 50 })
  purpose: string;

  /** Компания (тенант), которой атрибутирован расход. NULL — платформенные/кэш-разделяемые
   *  вызовы (перевод запросов, regulatory-выжимки), которые нельзя отнести к одной компании. */
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  @Column({ type: 'int', name: 'input_tokens' })
  inputTokens: number;

  @Column({ type: 'int', name: 'output_tokens' })
  outputTokens: number;

  @Column({ type: 'int', name: 'cache_creation_tokens', default: 0 })
  cacheCreationTokens: number;

  @Column({ type: 'int', name: 'cache_read_tokens', default: 0 })
  cacheReadTokens: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
