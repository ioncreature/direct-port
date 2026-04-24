import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiCall } from '../database/entities/ai-call.entity';
import { DocumentVersion } from '../database/entities/document-version.entity';
import { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';

export type AiCallLite = Omit<AiCall, 'request' | 'response' | 'stageRun' | 'document'>;

export type StageRunWithAiCalls = Omit<PipelineStageRun, 'aiCalls' | 'document'> & {
  aiCalls: AiCallLite[];
};

export type DocumentVersionLite = Omit<DocumentVersion, 'snapshot' | 'document'>;

const AI_CALL_LITE_FIELDS: (keyof AiCall)[] = [
  'id',
  'stageRunId',
  'documentId',
  'purpose',
  'model',
  'attempt',
  'error',
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'latencyMs',
  'startedAt',
  'finishedAt',
];

const VERSION_LITE_FIELDS: (keyof DocumentVersion)[] = [
  'id',
  'documentId',
  'version',
  'reason',
  'actorType',
  'actorId',
  'createdAt',
];

@Injectable()
export class DiagnosticsService {
  constructor(
    @InjectRepository(PipelineStageRun)
    private stageRunRepo: Repository<PipelineStageRun>,
    @InjectRepository(AiCall) private aiCallRepo: Repository<AiCall>,
    @InjectRepository(DocumentVersion)
    private versionRepo: Repository<DocumentVersion>,
  ) {}

  async findStageRunsByDocument(documentId: string): Promise<StageRunWithAiCalls[]> {
    const stageRuns = await this.stageRunRepo.find({
      where: { documentId },
      order: { startedAt: 'ASC' },
    });
    if (stageRuns.length === 0) return [];

    const aiCalls = await this.aiCallRepo.find({
      where: { stageRunId: In(stageRuns.map((s) => s.id)) },
      select: AI_CALL_LITE_FIELDS,
      order: { startedAt: 'ASC' },
    });

    const grouped = new Map<string, AiCallLite[]>();
    for (const call of aiCalls) {
      if (!call.stageRunId) continue;
      const list = grouped.get(call.stageRunId);
      if (list) list.push(call as AiCallLite);
      else grouped.set(call.stageRunId, [call as AiCallLite]);
    }

    return stageRuns.map((sr) => ({
      ...sr,
      aiCalls: grouped.get(sr.id) ?? [],
    }));
  }

  async findAiCallById(documentId: string, aiCallId: string): Promise<AiCall> {
    const call = await this.aiCallRepo.findOne({
      where: { id: aiCallId, documentId },
    });
    if (!call) throw new NotFoundException('AI call not found');
    return call;
  }

  async findVersionsByDocument(documentId: string): Promise<DocumentVersionLite[]> {
    const versions = await this.versionRepo.find({
      where: { documentId },
      select: VERSION_LITE_FIELDS,
      order: { version: 'DESC' },
    });
    return versions as DocumentVersionLite[];
  }

  async findVersionByNumber(documentId: string, version: number): Promise<DocumentVersion> {
    const row = await this.versionRepo.findOne({ where: { documentId, version } });
    if (!row) throw new NotFoundException('Document version not found');
    return row;
  }
}
