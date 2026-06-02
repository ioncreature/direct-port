import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

interface Opts {
  client?: { id: string; telegramId: string; language: string; assignedManagerId: string | null } | null;
  manager?: { id: string; isActive: boolean; managerTelegramId: string } | null;
  userById?: { id: string; managerTelegramId: string | null } | null;
  claimAffected?: number;
  tokenUserId?: string | null;
}

function createService(opts: Opts = {}) {
  const messagesRepo = {
    create: jest.fn().mockImplementation((d) => d),
    save: jest.fn().mockImplementation(async (d) => ({ ...d, id: 'msg-1' })),
    find: jest.fn().mockResolvedValue([]),
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
  const documents = { startProcessing: jest.fn().mockResolvedValue({ id: 'doc-1' }) };

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

const ACTIVE_MANAGER = { id: 'mgr-1', isActive: true, managerTelegramId: '999' };
const UNASSIGNED_CLIENT = { id: 'cli-1', telegramId: '12345', language: 'ru', assignedManagerId: null };

describe('ConversationsService', () => {
  describe('claimByManagerTelegram', () => {
    it('assigns an unclaimed client to the manager', async () => {
      const { service, updateQb } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
        claimAffected: 1,
      });
      const res = await service.claimByManagerTelegram('cli-1', '999');
      expect(res).toEqual({ clientId: 'cli-1', managerId: 'mgr-1' });
      expect(updateQb.execute).toHaveBeenCalled();
    });

    it('is idempotent when already assigned to the same manager', async () => {
      const { service, updateQb } = createService({
        manager: ACTIVE_MANAGER,
        client: { ...UNASSIGNED_CLIENT, assignedManagerId: 'mgr-1' },
      });
      const res = await service.claimByManagerTelegram('cli-1', '999');
      expect(res).toEqual({ clientId: 'cli-1', managerId: 'mgr-1' });
      expect(updateQb.execute).not.toHaveBeenCalled();
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
  });

  describe('managerReply', () => {
    it('stores the message and enqueues delivery to the client', async () => {
      const { service, messagesRepo, clientOutQueue } = createService({
        manager: ACTIVE_MANAGER,
        client: UNASSIGNED_CLIENT,
      });
      await service.managerReply('999', 'cli-1', 'Здравствуйте');
      expect(messagesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'manager_to_client', managerId: 'mgr-1', text: 'Здравствуйте' }),
      );
      expect(clientOutQueue.add).toHaveBeenCalledWith('client-message', {
        clientTelegramId: '12345',
        text: 'Здравствуйте',
        language: 'ru',
      });
    });
  });
});
