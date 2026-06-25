import { Document, DocumentStatus } from '../database/entities/document.entity';
import { PipelineNotifierService } from './pipeline-notifier.service';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    source: 'self_service',
    status: DocumentStatus.PROCESSED,
    originalFileName: 'goods.xlsx',
    ...overrides,
  });
  return doc;
}

function createService() {
  const managerNotify = { notifyDocumentEvent: jest.fn().mockResolvedValue(undefined) };
  const clientOutQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new PipelineNotifierService(managerNotify as never, clientOutQueue as never);
  return { service, managerNotify, clientOutQueue };
}

describe('PipelineNotifierService.notify', () => {
  it('managed: уведомляет менеджера (событие выводится из doc.status), не клиента', async () => {
    const { service, managerNotify, clientOutQueue } = createService();
    const doc = makeDoc({ source: 'managed' });
    await service.notify(doc);
    expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
    expect(clientOutQueue.add).not.toHaveBeenCalled();
  });

  it('self_service без telegramUserId (админская загрузка): no-op', async () => {
    const { service, managerNotify, clientOutQueue } = createService();
    await service.notify(makeDoc({ source: 'self_service', telegramUserId: null }));
    expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
    expect(clientOutQueue.add).not.toHaveBeenCalled();
  });

  it('кабинетный self_service PROCESSED: доставляет клиенту готовый Excel', async () => {
    const { service, clientOutQueue } = createService();
    const doc = makeDoc({
      source: 'self_service',
      telegramUserId: 'tg-1',
      telegramUser: { telegramId: '12345', language: 'en' } as never,
      status: DocumentStatus.PROCESSED,
    });
    await service.notify(doc);
    expect(clientOutQueue.add).toHaveBeenCalledWith(
      'client-message',
      expect.objectContaining({
        clientTelegramId: '12345',
        language: 'en',
        documentId: 'doc-1',
        documentFileName: 'goods.xlsx',
      }),
      expect.anything(),
    );
  });

  it('кабинетный self_service FAILED: текстовый нудж (i18nKey, без файла)', async () => {
    const { service, clientOutQueue } = createService();
    const doc = makeDoc({
      source: 'self_service',
      telegramUserId: 'tg-1',
      telegramUser: { telegramId: '12345', language: 'ru' } as never,
      status: DocumentStatus.FAILED,
    });
    await service.notify(doc);
    expect(clientOutQueue.add).toHaveBeenCalledWith(
      'client-message',
      expect.objectContaining({ clientTelegramId: '12345', i18nKey: 'cabinet-doc-issue' }),
      expect.anything(),
    );
    expect(clientOutQueue.add.mock.calls[0][1].documentId).toBeUndefined();
  });

  it('кабинетный self_service промежуточный статус (PARSING): не уведомляет', async () => {
    const { service, clientOutQueue } = createService();
    await service.notify(
      makeDoc({
        source: 'self_service',
        telegramUserId: 'tg-1',
        telegramUser: { telegramId: '1', language: 'ru' } as never,
        status: DocumentStatus.PARSING,
      }),
    );
    expect(clientOutQueue.add).not.toHaveBeenCalled();
  });

  it('best-effort: сбой резолва/уведомления менеджера проглатывается', async () => {
    const { service, managerNotify } = createService();
    managerNotify.notifyDocumentEvent.mockRejectedValueOnce(new Error('DB down'));
    await expect(service.notify(makeDoc({ source: 'managed' }))).resolves.toBeUndefined();
  });

  it('best-effort: сбой постановки в client-bot-outgoing проглатывается', async () => {
    const { service, clientOutQueue } = createService();
    clientOutQueue.add.mockRejectedValueOnce(new Error('Redis down'));
    const doc = makeDoc({
      source: 'self_service',
      telegramUserId: 'tg-1',
      telegramUser: { telegramId: '1', language: 'ru' } as never,
      status: DocumentStatus.PROCESSED,
    });
    await expect(service.notify(doc)).resolves.toBeUndefined();
  });
});
