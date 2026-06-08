import { DocumentStatus } from '../database/entities/document.entity';
import { ManagerNotifyService } from './manager-notify.service';

interface Opts {
  assignedManager?: { managerTelegramId: string | null } | null;
  allManagers?: Array<{ managerTelegramId: string | null }>;
}

function createService(opts: Opts = {}) {
  const usersRepo = {
    findOne: jest.fn().mockResolvedValue(opts.assignedManager ?? null),
    find: jest.fn().mockResolvedValue(opts.allManagers ?? []),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ManagerNotifyService(usersRepo as never, queue as never);
  return { service, usersRepo, queue };
}

function makeDoc(status: DocumentStatus, assignedManagerId: string | null) {
  return {
    id: 'doc-1',
    status,
    originalFileName: 'goods.xlsx',
    statusLabel: 'label',
    telegramUser: {
      id: 'cli-1',
      telegramId: '12345',
      firstName: 'Иван',
      lastName: null,
      username: null,
      assignedManagerId,
    },
  } as never;
}

describe('ManagerNotifyService.notifyDocumentEvent', () => {
  it('routes a finished pipeline to the assigned manager', async () => {
    const { service, queue, usersRepo } = createService({
      assignedManager: { managerTelegramId: '999' },
    });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.PROCESSED, 'mgr-1'));
    expect(usersRepo.findOne).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({
        event: 'pipeline_done',
        managerTelegramIds: ['999'],
        assigned: true,
        documentId: 'doc-1',
        resultReady: true,
      }),
    );
  });

  it('broadcasts to all linked managers when the client is unassigned', async () => {
    const { service, queue, usersRepo } = createService({
      allManagers: [{ managerTelegramId: '111' }, { managerTelegramId: '222' }],
    });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.FAILED, null));
    expect(usersRepo.find).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({
        event: 'pipeline_failed',
        managerTelegramIds: ['111', '222'],
        resultReady: false,
      }),
    );
  });

  it('skips intermediate statuses (no manager notification)', async () => {
    const { service, queue } = createService({ assignedManager: { managerTelegramId: '999' } });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.PENDING, 'mgr-1'));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue when there are no linked managers', async () => {
    const { service, queue } = createService({ allManagers: [] });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.PROCESSED, null));
    expect(queue.add).not.toHaveBeenCalled();
  });
});
