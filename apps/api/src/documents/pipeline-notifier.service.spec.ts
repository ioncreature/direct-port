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
  const service = new PipelineNotifierService(managerNotify as never);
  return { service, managerNotify };
}

describe('PipelineNotifierService.notify', () => {
  it('managed: уведомляет менеджера (событие выводится из doc.status)', async () => {
    const { service, managerNotify } = createService();
    const doc = makeDoc({ source: 'managed' });
    await service.notify(doc);
    expect(managerNotify.notifyDocumentEvent).toHaveBeenCalledWith(doc);
  });

  it('self_service: no-op (бота-получателя нет после удаления tg-bot)', async () => {
    const { service, managerNotify } = createService();
    await service.notify(makeDoc({ source: 'self_service' }));
    expect(managerNotify.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('best-effort: сбой резолва/уведомления менеджера проглатывается', async () => {
    const { service, managerNotify } = createService();
    managerNotify.notifyDocumentEvent.mockRejectedValueOnce(new Error('DB down'));
    await expect(service.notify(makeDoc({ source: 'managed' }))).resolves.toBeUndefined();
  });
});
