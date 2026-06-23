import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from './document.entity';
import { TelegramUser } from './telegram-user.entity';
import { User } from './user.entity';

/**
 * Тип операции с депозитом клиента:
 *  - topup      — ручное пополнение менеджером (delta > 0)
 *  - charge     — списание pipeline за успешно обработанные позиции (delta < 0)
 *  - adjustment — ручная корректировка менеджером или возврат при пересчёте (любой знак)
 */
export type DepositTransactionType = 'topup' | 'charge' | 'adjustment';

/**
 * Журнал операций с депозитом клиента (ledger). Денормализованный баланс лежит в
 * TelegramUser.balance; здесь — полная история изменений для аудита и отображения.
 * Запись только добавляется, не правится.
 */
@Entity('deposit_transactions')
@Index(['telegramUserId', 'createdAt'])
export class DepositTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'telegram_user_id' })
  telegramUserId: string;

  @ManyToOne(() => TelegramUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'telegram_user_id' })
  telegramUser: TelegramUser;

  /** Изменение баланса в позициях: + пополнение/возврат, − списание. */
  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'varchar', length: 16 })
  type: DepositTransactionType;

  /** Снимок баланса после операции — для аудита и быстрого отображения истории. */
  @Column({ type: 'int', name: 'balance_after' })
  balanceAfter: number;

  /** Документ, к которому относится списание/возврат. NULL для ручных операций. */
  @Column({ type: 'uuid', name: 'document_id', nullable: true })
  documentId: string | null;

  @ManyToOne(() => Document, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: Document | null;

  /** Пользователь админки, выполнивший ручную операцию. NULL — системное списание. */
  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
