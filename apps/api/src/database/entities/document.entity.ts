import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TokenUsageByStage } from '../../common/token-usage';
import { TelegramUser } from './telegram-user.entity';
import { User } from './user.entity';

export enum DocumentStatus {
  PARSING = 'parsing',
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  PROCESSED_WITH_ERRORS = 'processed_with_errors',
  FAILED = 'failed',
  REQUIRES_REVIEW = 'requires_review',
  REJECTED = 'rejected',
}

export const documentStatusLabels: Record<DocumentStatus, string> = {
  [DocumentStatus.PARSING]: 'Распознавание',
  [DocumentStatus.PENDING]: 'Ожидает обработки',
  [DocumentStatus.PROCESSING]: 'Обработка',
  [DocumentStatus.PROCESSED]: 'Обработан',
  [DocumentStatus.PROCESSED_WITH_ERRORS]: 'Обработан с ошибками',
  [DocumentStatus.FAILED]: 'Ошибка',
  [DocumentStatus.REQUIRES_REVIEW]: 'Требует проверки',
  [DocumentStatus.REJECTED]: 'Отклонён',
};

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'telegram_user_id', nullable: true })
  telegramUserId: string | null;

  @Column({ type: 'uuid', name: 'uploaded_by_user_id', nullable: true })
  uploadedByUserId: string | null;

  @Column({ type: 'varchar', length: 500, name: 'original_file_name' })
  originalFileName: string;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.PENDING })
  status: DocumentStatus;

  @Column({ type: 'bytea', name: 'file_buffer', nullable: true, select: false })
  fileBuffer: Buffer | null;

  @Column({ type: 'jsonb', name: 'column_mapping', nullable: true })
  columnMapping: Record<string, number> | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency: string | null;

  @Column({ type: 'jsonb', name: 'exchange_rates', nullable: true })
  exchangeRates: Record<string, number> | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  language: string | null;

  @Column({ type: 'jsonb', name: 'parsed_data', nullable: true })
  parsedData: Record<string, unknown>[] | null;

  @Column({ type: 'jsonb', name: 'result_data', nullable: true })
  resultData: Record<string, unknown>[] | null;

  @Column({ type: 'int', name: 'row_count', default: 0 })
  rowCount: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', name: 'rejection_reasons', nullable: true })
  rejectionReasons: string[] | null;

  @Column({ type: 'jsonb', name: 'token_usage', nullable: true })
  tokenUsage: TokenUsageByStage | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => TelegramUser, (user) => user.documents, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'telegram_user_id' })
  telegramUser: TelegramUser | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User | null;

  get statusLabel(): string {
    return documentStatusLabels[this.status] ?? this.status;
  }

  toJSON() {
    return { ...this, statusLabel: this.statusLabel };
  }
}
