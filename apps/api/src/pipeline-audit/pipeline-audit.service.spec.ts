import type { Repository } from 'typeorm';
import type { AiCall } from '../database/entities/ai-call.entity';
import type { DocumentVersion } from '../database/entities/document-version.entity';
import type { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';
import { PipelineAuditService } from './pipeline-audit.service';

function makeService() {
  const stageRunQuery = jest.fn().mockResolvedValue(undefined);
  const stageRunRepo = {
    save: jest.fn().mockImplementation(async (row: PipelineStageRun) => ({ ...row, id: 'sr-1' })),
    create: jest.fn().mockImplementation((data) => data as PipelineStageRun),
    query: stageRunQuery,
  } as unknown as Repository<PipelineStageRun>;

  const aiCallRepo = {
    save: jest.fn(),
    create: jest.fn(),
  } as unknown as Repository<AiCall>;

  const versionRepo = {
    save: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
  } as unknown as Repository<DocumentVersion>;

  const service = new PipelineAuditService(stageRunRepo, aiCallRepo, versionRepo);
  return { service, stageRunQuery };
}

describe('PipelineAuditService.completeStageRun', () => {
  it('пишет status=ok, если partial не передан', async () => {
    const { service, stageRunQuery } = makeService();
    await service.completeStageRun('run-1', { output: { x: 1 } });
    expect(stageRunQuery).toHaveBeenCalledTimes(1);
    const [, params] = stageRunQuery.mock.calls[0];
    expect(params[0]).toBe('run-1');
    expect(params[1]).toBe('ok');
  });

  it('пишет status=ok, если partial=false', async () => {
    const { service, stageRunQuery } = makeService();
    await service.completeStageRun('run-2', { partial: false });
    const [, params] = stageRunQuery.mock.calls[0];
    expect(params[1]).toBe('ok');
  });

  it('пишет status=partial_ok, если partial=true', async () => {
    const { service, stageRunQuery } = makeService();
    await service.completeStageRun('run-3', { partial: true });
    const [, params] = stageRunQuery.mock.calls[0];
    expect(params[1]).toBe('partial_ok');
  });

  it('ничего не делает, если stageRunId=null', async () => {
    const { service, stageRunQuery } = makeService();
    await service.completeStageRun(null, { partial: true });
    expect(stageRunQuery).not.toHaveBeenCalled();
  });
});
