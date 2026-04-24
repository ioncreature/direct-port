import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TokenUsageMap } from '../../common/token-usage';
import { AiCall } from './ai-call.entity';
import { Document } from './document.entity';

export type PipelineStage = 'parse' | 'classify' | 'interpret' | 'calculate';

export type PipelineStageStatus = 'running' | 'ok' | 'failed';

@Entity('pipeline_stage_run')
@Index('idx_pipeline_stage_run_document', ['documentId', 'startedAt'])
export class PipelineStageRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar', length: 32 })
  stage: PipelineStage;

  @Column({ type: 'int', default: 1 })
  attempt: number;

  @Column({ type: 'varchar', length: 16 })
  status: PipelineStageStatus;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', name: 'duration_ms', nullable: true })
  durationMs: number | null;

  @Column({ type: 'jsonb', nullable: true })
  output: unknown;

  @Column({ type: 'jsonb', nullable: true })
  error: { message: string; stack?: string; code?: string } | null;

  @Column({ type: 'jsonb', name: 'token_usage', nullable: true })
  tokenUsage: TokenUsageMap | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @OneToMany(() => AiCall, (call) => call.stageRun)
  aiCalls: AiCall[];
}
