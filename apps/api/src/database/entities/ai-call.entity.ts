import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from './document.entity';
import { PipelineStageRun } from './pipeline-stage-run.entity';

export type AiCallPurpose =
  | 'parse_structure'
  | 'parse_products'
  | 'parse_chunk'
  | 'parse_validate'
  | 'classify_formulate_queries'
  | 'classify'
  | 'interpret'
  | 'translate_query';

@Entity('ai_call')
@Index('idx_ai_call_document', ['documentId', 'startedAt'])
export class AiCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'stage_run_id', nullable: true })
  stageRunId: string | null;

  @Column({ type: 'uuid', name: 'document_id', nullable: true })
  documentId: string | null;

  @Column({ type: 'varchar', length: 64 })
  purpose: AiCallPurpose;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'int', default: 1 })
  attempt: number;

  @Column({ type: 'jsonb' })
  request: unknown;

  @Column({ type: 'jsonb', nullable: true })
  response: unknown;

  @Column({ type: 'jsonb', nullable: true })
  error: { message: string; stack?: string } | null;

  @Column({ type: 'int', name: 'input_tokens', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', name: 'output_tokens', default: 0 })
  outputTokens: number;

  @Column({ type: 'int', name: 'cache_creation_tokens', default: 0 })
  cacheCreationTokens: number;

  @Column({ type: 'int', name: 'cache_read_tokens', default: 0 })
  cacheReadTokens: number;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;

  @ManyToOne(() => PipelineStageRun, (run) => run.aiCalls, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stage_run_id' })
  stageRun: PipelineStageRun | null;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document | null;
}
