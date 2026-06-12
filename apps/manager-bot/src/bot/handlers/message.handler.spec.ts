import { MessageHandler } from './message.handler';

type Dialog = { clientId: string; clientName: string; acked?: boolean } | null;

function createHandler(dialog: Dialog, ackedFirst = true) {
  const apiClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
  const activeDialog = {
    get: jest.fn().mockResolvedValue(dialog),
    set: jest.fn().mockResolvedValue(undefined),
    markAckedIfFirst: jest.fn().mockResolvedValue(ackedFirst),
  };
  const handler = new MessageHandler(apiClient as never, activeDialog as never);
  return { handler, apiClient, activeDialog };
}

function ctxWith(text: string) {
  return {
    chat: { id: 10 },
    from: { id: 20 },
    message: { text },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('MessageHandler (manager-bot)', () => {
  it('первый ответ в диалоге: доставляет и подтверждает', async () => {
    const { handler, apiClient, activeDialog } = createHandler(
      { clientId: 'cli-1', clientName: 'X' },
      true,
    );
    const ctx = ctxWith('привет');
    await handler.handle(ctx as never);
    expect(apiClient.sendMessage).toHaveBeenCalledWith(20, 'cli-1', 'привет');
    expect(activeDialog.markAckedIfFirst).toHaveBeenCalledWith(10);
    expect(ctx.reply).toHaveBeenCalledWith('✅ Отправлено клиенту.');
  });

  it('повторный ответ тому же клиенту: доставляет, не подтверждает, продлевает TTL диалога', async () => {
    const { handler, apiClient, activeDialog } = createHandler(
      { clientId: 'cli-1', clientName: 'X', acked: true },
      false,
    );
    const ctx = ctxWith('ещё сообщение');
    await handler.handle(ctx as never);
    expect(apiClient.sendMessage).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(activeDialog.set).toHaveBeenCalledWith(10, {
      clientId: 'cli-1',
      clientName: 'X',
      acked: true,
    });
  });

  it('не-текст в режиме ответа: предупреждает, что вложения не доставляются', async () => {
    const { handler } = createHandler({ clientId: 'cli-1', clientName: 'X' });
    const ctx = { chat: { id: 10 }, reply: jest.fn().mockResolvedValue(undefined) };
    await handler.handleNonText(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(
      'Клиенту можно отправить только текст — вложения в этом режиме не поддерживаются.',
    );
  });

  it('не-текст без активного диалога: молчит', async () => {
    const { handler } = createHandler(null);
    const ctx = { chat: { id: 10 }, reply: jest.fn().mockResolvedValue(undefined) };
    await handler.handleNonText(ctx as never);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('без активного диалога: подсказывает выбрать клиента, не шлёт', async () => {
    const { handler, apiClient, activeDialog } = createHandler(null);
    const ctx = ctxWith('текст');
    await handler.handle(ctx as never);
    expect(apiClient.sendMessage).not.toHaveBeenCalled();
    expect(activeDialog.markAckedIfFirst).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });
});
