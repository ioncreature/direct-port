import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Document } from './document.entity';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Document, (doc) => doc.telegramUser)
  documents: Document[];
}
