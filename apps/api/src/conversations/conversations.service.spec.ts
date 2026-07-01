import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DocumentStatus } from '../database/entities/document.entity';
import { ConversationsService } from './conversations.service';

interface Opts {
  client?: {
    id: string;
    telegramId: string;
    language: string;
    assignedManagerId: string | null;
    companyId?: string | null;
  } | null;
  manager?: { id: string; isActive: boolean; managerTelegramId: string; companyId?: string | null } | null;
  userById?: { id: string; managerTelegramId: string | null } | null;
  document?: {
    id: string;
    status: DocumentStatus;
    telegramUserId: string | null;
    telegramUser?: {
      id: string;
      telegramId: string;
      language: string;
      assignedManagerId: string | null;
    } | null;
    originalFileName: string;
  } | null;
  claimAffected?: number;
  tokenUserId?: string | null;
}

function createService(opts: Opts = {}) {
  const messagesRepo = {
    create: jest.fn().mockImplementation((d) => d),
    save: jest.fn().mockImplementation(async (d) => ({ ...d, id: 'msg-1' })),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
  };

  const updateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: opts.claimAffected ?? 1 }),
  };

  const clientsRepo = {
    findOne: jest.fn().mockResolvedValue(opts.client ?? null),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    createQueryBuilder: jest.fn().mockReturnValue(updateQb),
  };

  const usersRepo = {
    findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.managerTelegramId !== undefined) return Promise.resolve(opts.manager ?? null);
      if (where.id !== undefined) return Promise.resolve(opts.userById ?? null);
      return Promise.resolve(null);
    }),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockImplementation(async (u) => u),
  };

  const clientOutQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const linkService = {
    consumeToken: jest.fn().mockResolvedValue(opts.tokenUserId ?? null),
    createToken: jest.fn(),
  };
  const documents = {
    startProcessing: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    findOne: jest.fn().mockResolvedValue(opts.document ?? null),
  };

  const service = new ConversationsService(
    messagesRepo as never,
    clientsRepo as never,
    usersRepo as never,
    clientOutQueue as never,
    linkService as never,
    documents as never,
  );

  return { service, messagesRepo, clientsRepo, usersRepo, clientOutQueue, linkService, documents, updateQb };
}

// Доставочные очереди ставятся с ретраями (см. DELIVERY_JOB_OPTS).
const RETRY_OPTS = expect.objectContaining({ attempts: 5 });

const ACTIVE_MANAGER = { id: 'mgr-1', isActive: true, managerTelegramId: '999', companyId: 'comp-1' };
const UNASSIGNED_CLIENT = {
  id: 'cli-1',
  telegramId: '12345',
  language: 'ru',
  assignedManagerId: null,
  companyId: 'comp-1',
};
const ASSIGNED_CLIENT = { ...UNASSIGNED_CLIENT, assignedManagerId: 'mgr-1' };

describe('ConversationsService', () => {
  describe('claimByManagerTelegram', () => {
    it('assigns an unclaimed client in the manager company and notifies (no company inheritance)', async () => {
      const { service, updateQb, clientOutQueue, clientsRepo } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
        claimAffected: 1,
      });
      const res = await service.claimByManagerTelegram('cli-1', '999');
      expect(res).toEqual({ clientId: 'cli-1', managerId: 'mgr-1' });
      expect(updateQb.execute).toHaveBeenCalled();
      // Клиент уже принадлежит компании бота — claim больше не переносит компанию/документы.
      expect(clientsRepo.update).not.toHaveBeenCalled();
      expect(clientOutQueue.add).toHaveBeenCalledWith(
        'client-message',
        expect.objectContaining({ clientTelegramId: '12345', i18nKey: 'manager-assigned' }),
        RETRY_OPTS,
      );
    });

    it('throws 403 when the manager belongs to another company', async () => {
      const { service, updateQb } = createService({
        manager: { ...ACTIVE_MANAGER, companyId: 'comp-2' },
        client: UNASSIGNED_CLIENT, // comp-1
        claimAffected: 1,
      });
      await expect(service.claimByManagerTelegram('cli-1', '999')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(updateQb.execute).not.toHaveBeenCalled();
    });

    it('is idempotent when already assigned to the same manager (no re-notify)', async () => {
      const { service, updateQb, clientOutQueue } = createService({
        manager: ACTIVE_MANAGER,
        client: { ...UNASSIGNED_CLIENT, assignedManagerId: 'mgr-1' },
      });
      const res = await service.claimByManagerTelegram('cli-1', '999');
      expect(res).toEqual({ clientId: 'cli-1', managerId: 'mgr-1' });
      expect(updateQb.execute).not.toHaveBeenCalled();
      expect(clientOutQueue.add).not.toHaveBeenCalled();
    });

    it('throws 409 when another manager already claimed (race)', async () => {
      const { service } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
        claimAffected: 0,
      });
      await expect(service.claimByManagerTelegram('cli-1', '999')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws 403 when the manager Telegram is not linked', async () => {
      const { service } = createService({ manager: null, client: UNASSIGNED_CLIENT });
      await expect(service.claimByManagerTelegram('cli-1', '999')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('linkManager', () => {
    it('rejects an invalid/expired token', async () => {
      const { service } = createService({ tokenUserId: null });
      await expect(service.linkManager('bad', '999')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('links the Telegram id to the user (clearing prior owner)', async () => {
      const { service, usersRepo } = createService({
        tokenUserId: 'user-1',
        userById: { id: 'user-1', managerTelegramId: null },
      });
      const res = await service.linkManager('tok', '999');
      expect(res).toEqual({ userId: 'user-1' });
      // снимает старую привязку этого telegramId, затем сохраняет на найденном user
      expect(usersRepo.update).toHaveBeenCalledWith(
        { managerTelegramId: '999' },
        { managerTelegramId: null },
      );
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', managerTelegramId: '999' }),
      );
    });

    it('перепривязка к другому User освобождает клиентов прежнего владельца', async () => {
      const { service, usersRepo, clientsRepo } = createService({
        tokenUserId: 'user-2',
        userById: { id: 'user-2', managerTelegramId: null },
      });
      usersRepo.find.mockResolvedValue([{ id: 'user-1' }]);
      await service.linkManager('tok', '999');
      // клиенты user-1 возвращаются в broadcast-пул, а не висят на менеджере без Telegram
      expect(clientsRepo.update).toHaveBeenCalledWith(
        { assignedManagerId: 'user-1' },
        { assignedManagerId: null },
      );
    });
  });

  describe('unlinkManager', () => {
    it('снимает привязку и освобождает клиентов менеджера (нет «чёрной дыры»)', async () => {
      const { service, usersRepo, clientsRepo } = createService({
        userById: { id: 'user-1', managerTelegramId: '999' },
      });
      await service.unlinkManager('user-1');
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', managerTelegramId: null }),
      );
      expect(clientsRepo.update).toHaveBeenCalledWith(
        { assignedManagerId: 'user-1' },
        { assignedManagerId: null },
      );
    });
  });

  describe('managerReply', () => {
    it('stores the message and enqueues delivery to the client', async () => {
      const { service, messagesRepo, clientOutQueue } = createService({
        manager: ACTIVE_MANAGER,
        client: ASSIGNED_CLIENT,
      });
      await service.managerReply('999', 'cli-1', 'Здравствуйте');
      expect(messagesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'manager_to_client', managerId: 'mgr-1', text: 'Здравствуйте' }),
      );
      expect(clientOutQueue.add).toHaveBeenCalledWith(
        'client-message',
        {
          companyId: 'comp-1',
          clientTelegramId: '12345',
          text: 'Здравствуйте',
          language: 'ru',
        },
        RETRY_OPTS,
      );
    });
  });

  describe('sendDocumentToClient', () => {
    const PROCESSED_DOC = {
      id: 'doc-1',
      status: DocumentStatus.PROCESSED,
      telegramUserId: 'cli-1',
      telegramUser: ASSIGNED_CLIENT,
      originalFileName: 'goods.xlsx',
    };

    it('доставляет готовый расчёт клиенту: запись в БД + очередь с documentId', async () => {
      const { service, messagesRepo, clientOutQueue } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
        document: PROCESSED_DOC,
      });
      const res = await service.sendDocumentToClient('999', 'doc-1');
      expect(res).toEqual({ ok: true });
      expect(messagesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'manager_to_client',
          managerId: 'mgr-1',
          attachmentType: 'document',
          documentId: 'doc-1',
        }),
      );
      expect(clientOutQueue.add).toHaveBeenCalledWith(
        'client-message',
        {
          companyId: 'comp-1',
          clientTelegramId: '12345',
          language: 'ru',
          documentId: 'doc-1',
          documentFileName: 'goods.xlsx',
        },
        RETRY_OPTS,
      );
    });

    it('отклоняет документ не в статусе PROCESSED (download недоступен)', async () => {
      const { service, clientOutQueue } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
        document: { ...PROCESSED_DOC, status: DocumentStatus.PROCESSING },
      });
      await expect(service.sendDocumentToClient('999', 'doc-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(clientOutQueue.add).not.toHaveBeenCalled();
    });

    it('требует привязанного менеджера', async () => {
      const { service } = createService({
        manager: null,
        client: UNASSIGNED_CLIENT,
        document: PROCESSED_DOC,
      });
      await expect(service.sendDocumentToClient('999', 'doc-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
