import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ClientProfile } from '../auth/client-token.service';
import { PortalController } from './portal.controller';

// Принципал из проверенного client-JWT (то, что ClientAuthGuard кладёт в req.client).
const CLIENT: ClientProfile = {
  accountId: 'acc-from-jwt',
  telegramUserId: 'tgu-from-jwt',
  name: 'Иван',
  username: 'ivan_test',
  photoUrl: 'https://t.me/i/userpic/ivan.jpg',
};

function createController() {
  const api = {
    getBalance: jest.fn().mockResolvedValue({ balance: 42 }),
    getTransactions: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getDocuments: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    uploadDocument: jest.fn().mockResolvedValue({ id: 'doc-new' }),
    getPackages: jest.fn().mockResolvedValue([]),
    createTopUp: jest.fn().mockResolvedValue({ id: 'topup-1' }),
    getTopUps: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    cancelTopUp: jest.fn().mockResolvedValue({ id: 'topup-1', status: 'cancelled' }),
    downloadDocument: jest.fn().mockResolvedValue({
      buffer: Buffer.from('xlsx-bytes'),
      contentType: 'application/vnd.test',
      contentDisposition: 'attachment; filename="result.xlsx"',
    }),
  };
  return { controller: new PortalController(api as any), api };
}

describe('PortalController', () => {
  describe('скоупинг денег по JWT (ключевой инвариант)', () => {
    it('createTopUp: accountId и telegramUserId уходят в api ИЗ токена, чужие id из тела игнорируются', async () => {
      const { controller, api } = createController();
      // Атакующий подсовывает чужие id в тело запроса. whitelist ValidationPipe их
      // отрежет ещё раньше, но и сам контроллер обязан их не читать.
      const poisonedBody = {
        packageKey: 'p500',
        accountId: 'attacker-account',
        telegramUserId: 'attacker-tgu',
      } as any;

      await controller.createTopUp(CLIENT, poisonedBody);

      expect(api.createTopUp).toHaveBeenCalledTimes(1);
      expect(api.createTopUp).toHaveBeenCalledWith('acc-from-jwt', {
        packageKey: 'p500',
        telegramUserId: 'tgu-from-jwt',
      });
      // В payload нет ничего от attacker.
      const [accountId, payload] = api.createTopUp.mock.calls[0];
      expect(accountId).not.toBe('attacker-account');
      expect(JSON.stringify(payload)).not.toContain('attacker');
    });

    it('uploadDocument: файл форвардится с accountId/telegramUserId из токена', async () => {
      const { controller, api } = createController();
      const file = {
        buffer: Buffer.from('file-bytes'),
        originalname: 'invoice.xlsx',
      } as Express.Multer.File;

      await controller.uploadDocument(CLIENT, file);

      expect(api.uploadDocument).toHaveBeenCalledWith(
        'acc-from-jwt',
        'tgu-from-jwt',
        file.buffer,
        'invoice.xlsx',
      );
    });

    it('uploadDocument без файла → 400, api не вызывается', () => {
      const { controller, api } = createController();
      expect(() => controller.uploadDocument(CLIENT, undefined as any)).toThrow(
        BadRequestException,
      );
      expect(api.uploadDocument).not.toHaveBeenCalled();
    });

    it('cancelTopUp: accountId из токена + id заявки из пути', async () => {
      const { controller, api } = createController();
      await controller.cancelTopUp(CLIENT, 'topup-9');
      expect(api.cancelTopUp).toHaveBeenCalledWith('acc-from-jwt', 'topup-9');
    });
  });

  describe('read-only витрина', () => {
    it('me: баланс запрашивается по accountId из токена, профиль — из токена без запроса в api', async () => {
      const { controller, api } = createController();
      const result = await controller.me(CLIENT);
      expect(api.getBalance).toHaveBeenCalledWith('acc-from-jwt');
      expect(result).toEqual({
        telegramUserId: 'tgu-from-jwt',
        name: CLIENT.name,
        username: CLIENT.username,
        photoUrl: CLIENT.photoUrl,
        balance: 42,
      });
      // accountId наружу не отдаётся.
      expect(result).not.toHaveProperty('accountId');
    });

    it('transactions: пагинация форвардится, accountId — из токена', async () => {
      const { controller, api } = createController();
      await controller.transactions(CLIENT, { page: 2, limit: 50 } as any);
      expect(api.getTransactions).toHaveBeenCalledWith('acc-from-jwt', { page: 2, limit: 50 });
    });

    it('documents: query форвардится целиком, accountId — из токена', async () => {
      const { controller, api } = createController();
      const query = { page: 1, limit: 20, status: 'processed' } as any;
      await controller.documents(CLIENT, query);
      expect(api.getDocuments).toHaveBeenCalledWith('acc-from-jwt', query);
    });

    it('document: id из пути, accountId — из токена (чужой документ отсечёт api → 404)', async () => {
      const { controller, api } = createController();
      await controller.document(CLIENT, 'doc-42');
      expect(api.getDocument).toHaveBeenCalledWith('acc-from-jwt', 'doc-42');
    });

    it('topUps: список заявок по accountId из токена', async () => {
      const { controller, api } = createController();
      await controller.topUps(CLIENT, { page: 1, limit: 20 } as any);
      expect(api.getTopUps).toHaveBeenCalledWith('acc-from-jwt', { page: 1, limit: 20 });
    });

    it('download: проксирует буфер и заголовки из api', async () => {
      const { controller, api } = createController();
      const res = { set: jest.fn(), send: jest.fn() };

      await controller.download(CLIENT, 'doc-42', res as any);

      expect(api.downloadDocument).toHaveBeenCalledWith('acc-from-jwt', 'doc-42');
      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/vnd.test',
        'Content-Disposition': 'attachment; filename="result.xlsx"',
      });
      expect(res.send).toHaveBeenCalledWith(Buffer.from('xlsx-bytes'));
    });
  });
});
