import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('tks_cache')
export class TksCache {
  @PrimaryColumn({ type: 'varchar', length: 1024 })
  key: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'other' })
  category: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
  fetchedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
