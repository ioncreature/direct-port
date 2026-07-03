import { FindOperator } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
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
      companyId: 'co-1',
    },
  } as never;
}

// Доставка ретраится: молча потерянное уведомление — потерянный клиентский запрос.
const RETRY_OPTS = expect.objectContaining({ attempts: 5 });

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
        companyId: 'co-1',
        managerTelegramIds: ['999'],
        assigned: true,
        documentId: 'doc-1',
        resultReady: true,
      }),
      RETRY_OPTS,
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
      RETRY_OPTS,
    );
  });

  it('падает обратно на broadcast, когда назначенный менеджер отвязан/неактивен', async () => {
    const { service, queue } = createService({
      // findOne (assigned, с isActive в where) ничего не вернул — менеджер отвязан.
      assignedManager: null,
      allManagers: [{ managerTelegramId: '111' }],
    });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.PROCESSED, 'mgr-gone'));
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({ managerTelegramIds: ['111'] }),
      RETRY_OPTS,
    );
  });

  it('включает глобального менеджера (super_admin, company IS NULL) в broadcast', async () => {
    // У компании клиента нет своих менеджеров — событие должен получить глобальный super_admin.
    const { service, usersRepo, queue } = createService({
      allManagers: [{ managerTelegramId: 'super' }],
    });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.FAILED, null));
    const where = usersRepo.find.mock.calls[0][0].where;
    expect(where).toHaveLength(2);
    expect(where[0].companyId).toBe('co-1'); // компания клиента
    expect(where[1].companyId).toBeInstanceOf(FindOperator); // IsNull() — глобальные менеджеры
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({ managerTelegramIds: ['super'] }),
      RETRY_OPTS,
    );
  });

  it('резолвит назначенного глобального менеджера (super_admin, company IS NULL)', async () => {
    const { service, usersRepo, queue } = createService({
      assignedManager: { managerTelegramId: 'super' },
    });
    await service.notifyDocumentEvent(makeDoc(DocumentStatus.PROCESSED, 'mgr-super'));
    const where = usersRepo.findOne.mock.calls[0][0].where;
    expect(where).toHaveLength(2);
    expect(where[0]).toMatchObject({ id: 'mgr-super', companyId: 'co-1' });
    expect(where[1].companyId).toBeInstanceOf(FindOperator); // IsNull()
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({ managerTelegramIds: ['super'], assigned: true }),
      RETRY_OPTS,
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

describe('ManagerNotifyService.notifyLeadsReport', () => {
  it('broadcasts the report text to all linked managers', async () => {
    const { service, queue } = createService({
      allManagers: [{ managerTelegramId: '111' }, { managerTelegramId: '222' }],
    });
    const res = await service.notifyLeadsReport('Найдено 8 лидов, 3 горячих');
    expect(res).toEqual({ delivered: true });
    expect(queue.add).toHaveBeenCalledWith(
      'manager-notify',
      expect.objectContaining({
        event: 'leads_report',
        companyId: DEFAULT_COMPANY_ID,
        managerTelegramIds: ['111', '222'],
        text: 'Найдено 8 лидов, 3 горячих',
      }),
      RETRY_OPTS,
    );
  });

  it('does not enqueue when no managers are linked', async () => {
    const { service, queue } = createService({ allManagers: [] });
    const res = await service.notifyLeadsReport('отчёт');
    expect(res).toEqual({ delivered: false });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
