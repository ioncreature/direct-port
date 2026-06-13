import { Document, DocumentStatus } from '../database/entities/document.entity';
import { PipelineNotifierService } from './pipeline-notifier.service';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    source: 'self_service',
    status: DocumentStatus.PROCESSED,
    originalFileName: 'goods.xlsx',
    language: 'ru',
    createdAt: new Date('2026-04-20T10:00:00Z'),
    telegramUser: { telegramId: '12345', firstName: 'Иван', language: 'ru' },
    ...overrides,
  });
  return doc;
}

function createService() {
  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const managerNotify = { notifyDocumentEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new PipelineNotifierService(notificationQueue as never, managerNotify as never);
  return { service, notificationQueue, managerNotify };
}

describe('PipelineNotifierService', () => {
  describe('notify', () => {
    it('self_service: кладёт document-ready в очередь, менеджера не трогает', async () => {
      const { service, notificationQueue, managerNotify } = createService();
      await service.notify({ doc: makeDoc(), status: 'processed', sendResultFile: true });
      expect(notificationQueue.add).toHaveBeenCalledWith(
        'document-ready',
        expect.objectContaining({
          documentId: 'doc-1',
          telegramUserId: '12345',
          status: 'processed',
          sendResultFile: true,
        }),
      );
      expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
    });

    it('managed: уведомляет менеджера, в очередь клиента ничего не кладёт', async () => {
      const { service, notificationQueue, managerNotify } = createService();
      const doc = makeDoc({ source: 'managed' });
      await service.notify({ doc, status: 'processed' });
      expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('self_service без telegramUser: payload пуст — ничего не отправляет', async () => {
      const { service, notificationQueue } = createService();
      await service.notify({ doc: makeDoc({ telegramUser: null }), status: 'processed' });
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('best-effort: сбой постановки в очередь проглатывается (не валит воркер)', async () => {
      const { service, notificationQueue } = createService();
      notificationQueue.add.mockRejectedValueOnce(new Error('Redis down'));
      await expect(service.notify({ doc: makeDoc(), status: 'processed' })).resolves.toBeUndefined();
    });

    it('best-effort: сбой резолва менеджера проглатывается', async () => {
      const { service, managerNotify } = createService();
      managerNotify.notifyDocumentEvent.mockRejectedValueOnce(new Error('DB down'));
      await expect(
        service.notify({ doc: makeDoc({ source: 'managed' }), status: 'processed' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyManagerOnly', () => {
    it('managed: уведомляет менеджера', async () => {
      const { service, managerNotify } = createService();
      const doc = makeDoc({ source: 'managed', status: DocumentStatus.REQUIRES_REVIEW });
      await service.notifyManagerOnly(doc);
      expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
    });

    it('self_service: no-op (клиента в REQUIRES_REVIEW не уведомляем)', async () => {
      const { service, managerNotify, notificationQueue } = createService();
      await service.notifyManagerOnly(makeDoc({ status: DocumentStatus.REQUIRES_REVIEW }));
      expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('best-effort: сбой уведомления менеджера проглатывается', async () => {
      const { service, managerNotify } = createService();
      managerNotify.notifyDocumentEvent.mockRejectedValueOnce(new Error('DB down'));
      await expect(
        service.notifyManagerOnly(makeDoc({ source: 'managed' })),
      ).resolves.toBeUndefined();
    });
  });
});
