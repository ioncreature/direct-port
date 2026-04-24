import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { AiCall } from '../database/entities/ai-call.entity';
import type { DocumentVersion } from '../database/entities/document-version.entity';
import type { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';
import { DiagnosticsService } from './diagnostics.service';

function makeService(overrides: {
  stageRuns?: PipelineStageRun[];
  aiCalls?: AiCall[];
  versions?: DocumentVersion[];
} = {}) {
  const stageRuns = overrides.stageRuns ?? [];
  const aiCalls = overrides.aiCalls ?? [];
  const versions = overrides.versions ?? [];

  const stageRunRepo = {
    find: jest.fn().mockResolvedValue(stageRuns),
  } as unknown as Repository<PipelineStageRun>;

  const aiCallRepo = {
    find: jest.fn().mockResolvedValue(aiCalls),
    findOne: jest.fn(),
  } as unknown as Repository<AiCall>;

  const versionRepo = {
    find: jest.fn().mockResolvedValue(versions),
    findOne: jest.fn(),
  } as unknown as Repository<DocumentVersion>;

  const service = new DiagnosticsService(stageRunRepo, aiCallRepo, versionRepo);
  return { service, stageRunRepo, aiCallRepo, versionRepo };
}

const DOC_ID = '11111111-1111-1111-1111-111111111111';

describe('DiagnosticsService', () => {
  describe('findStageRunsByDocument', () => {
    it('возвращает пустой массив, если стадий нет (без запроса к ai_call)', async () => {
      const { service, aiCallRepo } = makeService({ stageRuns: [] });
      const result = await service.findStageRunsByDocument(DOC_ID);
      expect(result).toEqual([]);
      expect(aiCallRepo.find).not.toHaveBeenCalled();
    });

    it('группирует AI-вызовы по stageRunId и сортирует стадии по startedAt', async () => {
      const stageRuns = [
        {
          id: 'sr-parse',
          documentId: DOC_ID,
          stage: 'parse',
          startedAt: new Date('2026-04-20T10:00:00Z'),
        },
        {
          id: 'sr-classify',
          documentId: DOC_ID,
          stage: 'classify',
          startedAt: new Date('2026-04-20T10:01:00Z'),
        },
      ] as PipelineStageRun[];

      const aiCalls = [
        { id: 'ai-1', stageRunId: 'sr-parse', purpose: 'parse_structure' },
        { id: 'ai-2', stageRunId: 'sr-parse', purpose: 'parse_products' },
        { id: 'ai-3', stageRunId: 'sr-classify', purpose: 'classify' },
      ] as AiCall[];

      const { service, stageRunRepo, aiCallRepo } = makeService({ stageRuns, aiCalls });
      const result = await service.findStageRunsByDocument(DOC_ID);

      expect(stageRunRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { documentId: DOC_ID },
          order: { startedAt: 'ASC' },
        }),
      );

      // aiCallRepo.find должен быть вызван с select без тяжёлых request/response
      const findArgs = (aiCallRepo.find as jest.Mock).mock.calls[0][0];
      expect(findArgs.select).toEqual(
        expect.arrayContaining(['id', 'purpose', 'inputTokens', 'latencyMs']),
      );
      expect(findArgs.select).not.toContain('request');
      expect(findArgs.select).not.toContain('response');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('sr-parse');
      expect(result[0].aiCalls).toHaveLength(2);
      expect(result[0].aiCalls.map((c) => c.id)).toEqual(['ai-1', 'ai-2']);
      expect(result[1].id).toBe('sr-classify');
      expect(result[1].aiCalls).toHaveLength(1);
    });

    it('возвращает стадию без AI-вызовов (напр. calculate), если их нет', async () => {
      const stageRuns = [
        { id: 'sr-calc', documentId: DOC_ID, stage: 'calculate' },
      ] as PipelineStageRun[];
      const { service } = makeService({ stageRuns, aiCalls: [] });
      const result = await service.findStageRunsByDocument(DOC_ID);
      expect(result).toHaveLength(1);
      expect(result[0].aiCalls).toEqual([]);
    });
  });

  describe('findAiCallById', () => {
    it('возвращает вызов, найденный по (id, documentId)', async () => {
      const call = { id: 'ai-1', documentId: DOC_ID } as AiCall;
      const { service, aiCallRepo } = makeService();
      (aiCallRepo.findOne as jest.Mock).mockResolvedValue(call);

      const result = await service.findAiCallById(DOC_ID, 'ai-1');
      expect(result).toBe(call);
      expect(aiCallRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ai-1', documentId: DOC_ID },
      });
    });

    it('бросает NotFoundException, если вызов не принадлежит документу', async () => {
      const { service, aiCallRepo } = makeService();
      (aiCallRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findAiCallById(DOC_ID, 'ai-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findVersionsByDocument', () => {
    it('возвращает версии, отсортированные по убыванию, без snapshot', async () => {
      const versions = [
        { id: 'v2', documentId: DOC_ID, version: 2, reason: 'manual_edit' },
        { id: 'v1', documentId: DOC_ID, version: 1, reason: 'ai_parse' },
      ] as DocumentVersion[];
      const { service, versionRepo } = makeService({ versions });

      const result = await service.findVersionsByDocument(DOC_ID);
      const findArgs = (versionRepo.find as jest.Mock).mock.calls[0][0];

      expect(findArgs.order).toEqual({ version: 'DESC' });
      expect(findArgs.select).toEqual(
        expect.arrayContaining(['id', 'version', 'reason', 'actorType']),
      );
      expect(findArgs.select).not.toContain('snapshot');
      expect(result).toHaveLength(2);
    });
  });

  describe('findVersionByNumber', () => {
    it('возвращает полную версию со snapshot', async () => {
      const v = {
        id: 'v1',
        documentId: DOC_ID,
        version: 1,
        snapshot: { parsedData: [], currency: 'USD', columnMapping: null },
      } as unknown as DocumentVersion;
      const { service, versionRepo } = makeService();
      (versionRepo.findOne as jest.Mock).mockResolvedValue(v);

      const result = await service.findVersionByNumber(DOC_ID, 1);
      expect(result).toBe(v);
      expect(versionRepo.findOne).toHaveBeenCalledWith({
        where: { documentId: DOC_ID, version: 1 },
      });
    });

    it('бросает NotFoundException, если версии нет', async () => {
      const { service, versionRepo } = makeService();
      (versionRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findVersionByNumber(DOC_ID, 99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
