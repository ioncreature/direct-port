import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingAccount } from './billing-account.entity';
import { TelegramUser } from './telegram-user.entity';
import { User } from './user.entity';

export type TopUpStatus = 'pending' | 'confirmed' | 'canceled';

const decimalTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};

/**
 * Заявка клиента на пополнение баланса. Денежный слой поверх кредитного ledger:
 * кредиты (позиции) остаются в deposit_transactions, а деньги (сумма/валюта/цена за
 * позицию) фиксируются здесь на момент заявки (тариф не задним числом).
 *
 * Флоу: клиент создаёт pending → менеджеру уходит уведомление → клиент платит вне
 * системы → менеджер подтверждает (confirmed) → ClientBalanceService зачисляет
 * topup-транзакцию с sourceRequestId (идемпотентно). Оплат онлайн нет.
 */
@Entity('top_up_requests')
@Index(['billingAccountId', 'createdAt'])
export class TopUpRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'billing_account_id' })
  billingAccountId: string;

  @ManyToOne(() => BillingAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'billing_account_id' })
  billingAccount: BillingAccount;

  /** Кто из сотрудников оформил заявку (под будущее 1:N, сейчас = единственный клиент). */
  @Column({ type: 'uuid', name: 'created_by_telegram_user_id' })
  createdByTelegramUserId: string;

  @ManyToOne(() => TelegramUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_telegram_user_id' })
  createdByTelegramUser: TelegramUser;

  /** Ключ пакета из справочника тарифов (PACKAGES). NULL — произвольная сумма (пока не используется). */
  @Column({ type: 'varchar', length: 32, name: 'package_key', nullable: true })
  packageKey: string | null;

  /** Сколько кредитов (позиций) запрошено. */
  @Column({ type: 'int' })
  positions: number;

  /** Деньги к оплате (зафиксированы на момент заявки). */
  @Column({ type: 'decimal', precision: 14, scale: 2, transformer: decimalTransformer })
  amount: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  /** Цена за позицию на момент заявки — чтобы изменение тарифа не било задним числом. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    name: 'price_per_position',
    transformer: decimalTransformer,
  })
  pricePerPosition: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TopUpStatus;

  /** Менеджер, подтвердивший оплату. NULL пока pending. */
  @Column({ type: 'uuid', name: 'confirmed_by_user_id', nullable: true })
  confirmedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'confirmed_by_user_id' })
  confirmedBy: User | null;

  @Column({ type: 'timestamptz', name: 'confirmed_at', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
