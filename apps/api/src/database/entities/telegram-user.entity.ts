import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Document } from './document.entity';
import { User } from './user.entity';

@Entity('telegram_users')
export class TelegramUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'bigint', name: 'telegram_id', unique: true })
  telegramId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username: string | null;

  @Column({ type: 'varchar', length: 255, name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 5, default: 'ru' })
  language: string;

  /** Менеджер, закреплённый за клиентом (claim). null — клиент в общем пуле (broadcast). */
  @Column({ type: 'uuid', name: 'assigned_manager_id', nullable: true })
  assignedManagerId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_manager_id' })
  assignedManager: User | null;

  /** Компания, которой принадлежит клиент. Проставляется при claim (= компания
   *  закрепившего менеджера). NULL — клиент в общем пуле, ещё не взят. */
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Document, (doc) => doc.telegramUser)
  documents: Document[];
}
