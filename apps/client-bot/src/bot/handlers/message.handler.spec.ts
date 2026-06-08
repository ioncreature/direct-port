import { MessageHandler } from './message.handler';

function createHandler() {
  const apiClient = { intakeMessage: jest.fn().mockResolvedValue(undefined) };
  const resolver = { resolveTelegramUserId: jest.fn().mockResolvedValue('cli-uuid') };
  const stateService = { markGreetedIfFirst: jest.fn().mockResolvedValue(true) };
  const handler = new MessageHandler(apiClient as never, resolver as never, stateService as never);
  return { handler, apiClient, resolver, stateService };
}

function ctxWith(message: Record<string, unknown>) {
  return {
    chat: { id: 100 },
    from: { id: 200 },
    message,
    reply: jest.fn().mockResolvedValue(undefined),
    t: (k: string) => k,
  };
}

describe('MessageHandler.handleText', () => {
  it('релеит текст менеджеру', async () => {
    const { handler, apiClient } = createHandler();
    const ctx = ctxWith({ text: 'Привет', message_id: 5 });
    await handler.handleText(ctx as never);
    expect(apiClient.intakeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: 'cli-uuid', text: 'Привет', telegramMessageId: 5 }),
    );
    expect(ctx.reply).toHaveBeenCalledWith('greeting-ack');
  });

  it('подтверждает только первый контакт — повторное сообщение без ответа', async () => {
    const { handler, stateService } = createHandler();
    stateService.markGreetedIfFirst.mockResolvedValue(false);
    const ctx = ctxWith({ text: 'ещё вопрос', message_id: 6 });
    await handler.handleText(ctx as never);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('игнорирует пустой текст', async () => {
    const { handler, apiClient } = createHandler();
    await handler.handleText(ctxWith({}) as never);
    expect(apiClient.intakeMessage).not.toHaveBeenCalled();
  });
});

describe('MessageHandler.handlePhoto', () => {
  it('релеит самое крупное фото как вложение', async () => {
    const { handler, apiClient } = createHandler();
    const ctx = ctxWith({
      photo: [{ file_id: 'small' }, { file_id: 'big' }],
      caption: 'подпись',
      message_id: 7,
    });
    await handler.handlePhoto(ctx as never);
    expect(apiClient.intakeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentType: 'photo',
        attachmentFileId: 'big',
        text: 'подпись',
      }),
    );
  });

  it('игнорирует сообщение без фото', async () => {
    const { handler, apiClient } = createHandler();
    await handler.handlePhoto(ctxWith({}) as never);
    expect(apiClient.intakeMessage).not.toHaveBeenCalled();
  });
});
