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

/**
 * Картинки уже ресайзнуты до ≤1024px JPEG — оригиналы из xlsx часто 1.5+ MB,
 * после ресайза ~50–150 KB. На одну товарную строку может быть несколько фото.
 */
@Entity('document_photo')
@Index('idx_document_photo_doc_row', ['documentId', 'rowIndex'])
@Index('idx_document_photo_hash', ['imageHash'])
export class DocumentPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'row_index', type: 'int' })
  rowIndex: number;

  @Column({ name: 'image_hash', type: 'varchar', length: 64 })
  imageHash: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 20 })
  mimeType: string;

  @Column({ type: 'bytea' })
  bytes: Buffer;

  @Column({ name: 'width_px', type: 'int', nullable: true })
  widthPx: number | null;

  @Column({ name: 'height_px', type: 'int', nullable: true })
  heightPx: number | null;

  @Column({ name: 'original_size_bytes', type: 'int', nullable: true })
  originalSizeBytes: number | null;

  @Column({ name: 'final_size_bytes', type: 'int', nullable: true })
  finalSizeBytes: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
