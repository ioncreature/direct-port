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

export type ConversationDirection = 'client_to_manager' | 'manager_to_client';
export type ConversationAttachmentType = 'document' | 'photo' | 'file';

/**
 * Одно сообщение переписки между клиентом (client-bot) и менеджером (manager-bot).
 * Хранится в БД для read-only истории в админке. Вложения (фото/доки) не хранятся
 * байтами — только Telegram file_id; каждый присланный xlsx/csv становится отдельным
 * Document (см. document_id + attachment_type='document'), остальные файлы — просто
 * вложения переписки.
 */
@Entity('conversation_messages')
@Index(['clientId', 'createdAt'])
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId: string;

  @ManyToOne(() => TelegramUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: TelegramUser;

  @Column({ type: 'varchar', length: 20 })
  direction: ConversationDirection;

  /** Менеджер-автор (для manager_to_client). null для сообщений клиента. */
  @Column({ type: 'uuid', name: 'manager_id', nullable: true })
  managerId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manager_id' })
  manager: User | null;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ type: 'varchar', length: 20, name: 'attachment_type', nullable: true })
  attachmentType: ConversationAttachmentType | null;

  /** Telegram file_id вложения (без хранения байт). */
  @Column({ type: 'varchar', length: 255, name: 'attachment_file_id', nullable: true })
  attachmentFileId: string | null;

  /** Ссылка на Document, если сообщение принесло файл для расчёта (xlsx/csv). */
  @Column({ type: 'uuid', name: 'document_id', nullable: true })
  documentId: string | null;

  @ManyToOne(() => Document, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: Document | null;

  @Column({ type: 'bigint', name: 'telegram_message_id', nullable: true })
  telegramMessageId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
