import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { RefreshToken } from './refresh-token.entity';

export enum UserRole {
  /** Глобальный администратор платформы: видит и управляет всеми компаниями.
   *  Единственная роль с company_id = NULL. */
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  CUSTOMS = 'customs',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  /** Компания (тенант) пользователя. NULL только у super_admin; admin/customs обязаны
   *  иметь компанию (БД-инвариант CHK_users_company_role). */
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id' })
  company: Company | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** Telegram ID привязанного менеджерского аккаунта (для manager-bot). Уникален среди
   *  заполненных (partial unique index). null — менеджер не привязал Telegram. */
  @Column({ type: 'bigint', name: 'manager_telegram_id', nullable: true })
  managerTelegramId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens: RefreshToken[];
}
