import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('calculation_logs')
export class CalculationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'varchar', length: 255, name: 'telegram_username', nullable: true })
  telegramUsername: string | null;

  @Column({ type: 'varchar', length: 255, name: 'file_name', nullable: true })
  fileName: string | null;

  @Column({ type: 'int', name: 'items_count', default: 0 })
  itemsCount: number;

  @Column({ type: 'jsonb', name: 'result_summary', nullable: true })
  resultSummary: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
