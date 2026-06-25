import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Биллинг-аккаунт клиента — владелец депозита (баланса в «обработанных позициях») и
 * журнала операций (deposit_transactions). Пока ровно один аккаунт на TelegramUser (1:1),
 * связь заложена под будущее «компания + несколько сотрудников» (1:N) без переписывания
 * биллинга. Баланс пополняется менеджером (topup/grant), списывается pipeline за успешно
 * посчитанные позиции (ClientBalanceService).
 */
@Entity('billing_accounts')
export class BillingAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Депозит в позициях. Денормализованный счётчик; источник правды — deposit_transactions. */
  @Column({ type: 'int', default: 0 })
  balance: number;

  /** Компания-владелец (тенант) — задел под 1:N. Сейчас тенант-скоуп идёт через
   *  TelegramUser.companyId; при claim это поле пока НЕ обновляется (доработать вместе
   *  с тенант-скоупом баланса). Для существующих клиентов заполнено бэкафиллом миграции. */
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
