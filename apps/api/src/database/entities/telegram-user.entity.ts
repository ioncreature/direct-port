import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { BillingAccount } from './billing-account.entity';
import { Document } from './document.entity';
import { User } from './user.entity';

// Клиент уникален парой (компания, telegram_id): один человек — независимый клиент в каждой
// компании. Имя констрейнта совпадает с миграцией AddCompanyBotsFoundation. См. docs/COMPANY_BOTS.md.
@Entity('telegram_users')
@Unique('UQ_telegram_users_company_telegram', ['companyId', 'telegramId'])
export class TelegramUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // @Index (без unique) сохраняем: поиск по telegram_id ещё нужен (админский lookup, резолв).
  @Index()
  @Column({ type: 'bigint', name: 'telegram_id' })
  telegramId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username: string | null;

  @Column({ type: 'varchar', length: 255, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 5, default: 'ru' })
  language: string;

  /** Биллинг-аккаунт клиента (владелец баланса и журнала операций). Пока 1:1, заведён под
   *  будущее «компания + несколько сотрудников». Создаётся вместе с клиентом при register. */
  @Column({ type: 'uuid', name: 'billing_account_id' })
  billingAccountId: string;

  @ManyToOne(() => BillingAccount)
  @JoinColumn({ name: 'billing_account_id' })
  billingAccount: BillingAccount;

  /** Менеджер, закреплённый за клиентом (claim). null — клиент в общем пуле (broadcast). */
  @Column({ type: 'uuid', name: 'assigned_manager_id', nullable: true })
  assignedManagerId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_manager_id' })
  assignedManager: User | null;

  /** Компания, которой принадлежит клиент. NOT NULL: проставляется при регистрации (компания
   *  бота, через который пришёл клиент; до Фазы 3 входящий бот один — env, поэтому дефолтная
   *  компания платформы). Клиент уникален в паре (company_id, telegram_id) — один человек может
   *  быть клиентом нескольких компаний независимо. См. docs/COMPANY_BOTS.md. */
  @Column({ type: 'uuid', name: 'company_id' })
  companyId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Document, (doc) => doc.telegramUser)
  documents: Document[];
}
