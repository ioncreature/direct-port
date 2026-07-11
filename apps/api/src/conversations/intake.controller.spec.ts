import { ServiceUnavailableException } from '@nestjs/common';
import { IntakeController } from './intake.controller';

const CLIENT = { id: 'cli-1', companyId: 'co-1' };

function createController() {
  const documents = {
    createFromFile: jest.fn().mockResolvedValue({ id: 'doc-1', status: 'intake' }),
  };
  const conversations = {
    resolveClientOrThrow: jest.fn().mockResolvedValue(CLIENT),
    appendClientMessage: jest.fn().mockResolvedValue(undefined),
  };
  const managerNotify = {
    assertDeliverable: jest.fn().mockResolvedValue(undefined),
    notifyNewDocument: jest.fn().mockResolvedValue(undefined),
    notifyClientMessage: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new IntakeController(
    documents as never,
    conversations as never,
    managerNotify as never,
  );
  return { controller, documents, conversations, managerNotify };
}

const file = { buffer: Buffer.from('x'), originalname: 'goods.xlsx' } as never;

describe('IntakeController.intakeDocument', () => {
  it('happy path: документ создан, сообщение записано, менеджер уведомлён', async () => {
    const { controller, documents, managerNotify } = createController();
    const res = await controller.intakeDocument(file, { telegramUserId: 'cli-1' } as never);
    expect(res).toEqual({ id: 'doc-1', status: 'intake' });
    expect(documents.createFromFile).toHaveBeenCalled();
    expect(managerNotify.notifyNewDocument).toHaveBeenCalled();
  });

  it('нет менеджеров → 503 ДО создания документа (повтор клиента не плодит INTAKE-дубликаты)', async () => {
    const { controller, documents, conversations, managerNotify } = createController();
    managerNotify.assertDeliverable.mockRejectedValue(new ServiceUnavailableException());
    await expect(
      controller.intakeDocument(file, { telegramUserId: 'cli-1' } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(documents.createFromFile).not.toHaveBeenCalled();
    expect(conversations.appendClientMessage).not.toHaveBeenCalled();
  });
});

describe('IntakeController.intakeMessage', () => {
  it('нет менеджеров → 503 ДО записи в переписку (повтор не плодит дубликаты сообщений)', async () => {
    const { controller, conversations, managerNotify } = createController();
    managerNotify.assertDeliverable.mockRejectedValue(new ServiceUnavailableException());
    await expect(
      controller.intakeMessage({ telegramUserId: 'cli-1', text: 'привет' } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(conversations.appendClientMessage).not.toHaveBeenCalled();
  });

  it('happy path: сообщение записано и передано менеджеру', async () => {
    const { controller, conversations, managerNotify } = createController();
    await expect(
      controller.intakeMessage({ telegramUserId: 'cli-1', text: 'привет' } as never),
    ).resolves.toEqual({ ok: true });
    expect(conversations.appendClientMessage).toHaveBeenCalled();
    expect(managerNotify.notifyClientMessage).toHaveBeenCalled();
  });
});
