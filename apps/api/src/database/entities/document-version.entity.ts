import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Document } from './document.entity';

export type DocumentVersionReason = 'ai_parse' | 'manual_edit' | 'reprocess';

export type DocumentVersionActorType = 'system' | 'user' | 'telegram';

export interface DocumentVersionSnapshot {
  parsedData: Record<string, unknown>[] | null;
  currency: string | null;
  columnMapping: Record<string, number> | null;
}

@Entity('document_version')
@Unique(['documentId', 'version'])
@Index('idx_document_version_document', ['documentId', 'version'])
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 32 })
  reason: DocumentVersionReason;

  @Column({ type: 'varchar', length: 16, name: 'actor_type', nullable: true })
  actorType: DocumentVersionActorType | null;

  @Column({ type: 'varchar', length: 64, name: 'actor_id', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb' })
  snapshot: DocumentVersionSnapshot;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;
}
