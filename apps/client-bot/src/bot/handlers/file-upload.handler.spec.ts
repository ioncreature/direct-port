import { FileUploadHandler } from './file-upload.handler';

function createHandler() {
  const apiClient = {
    intakeDocument: jest.fn().mockResolvedValue({ id: 'doc-1', status: 'intake' }),
    intakeMessage: jest.fn().mockResolvedValue(undefined),
  };
  const resolver = { resolveTelegramUserId: jest.fn().mockResolvedValue('cli-uuid') };
  const stateService = { markGreetedIfFirst: jest.fn().mockResolvedValue(true) };
  const handler = new FileUploadHandler(apiClient as never, resolver as never, stateService as never);
  return { handler, apiClient, resolver, stateService };
}

function ctxWith(document: Record<string, unknown>, caption?: string) {
  return {
    chat: { id: 1 },
    from: { id: 2, language_code: 'ru' },
    message: { document, message_id: 9, caption },
    reply: jest.fn().mockResolvedValue(undefined),
    getFile: jest.fn().mockResolvedValue({ file_path: 'path/file' }),
    api: { token: 'TKN' },
    t: (k: string) => k,
  };
}

describe('FileUploadHandler.handle', () => {
  it('не-таблица (.pdf) → релеит как вложение, без intakeDocument', async () => {
    const { handler, apiClient } = createHandler();
    await handler.handle(
      ctxWith({ file_name: 'photo.pdf', file_id: 'fid', file_size: 100 }) as never,
    );
    expect(apiClient.intakeDocument).not.toHaveBeenCalled();
    expect(apiClient.intakeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentType: 'file', attachmentFileId: 'fid' }),
    );
  });

  it('.xlsx с подписью → скачивает и пробрасывает caption в intakeDocument', async () => {
    const { handler, apiClient } = createHandler();
    const realFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }) as never;
    try {
      await handler.handle(
        ctxWith({ file_name: 'goods.xlsx', file_id: 'fid', file_size: 100 }, 'это мой заказ') as never,
      );
      expect(apiClient.intakeDocument).toHaveBeenCalledWith(
        expect.any(Buffer),
        'goods.xlsx',
        'cli-uuid',
        'fid',
        'это мой заказ',
      );
    } finally {
      global.fetch = realFetch;
    }
  });

  it('слишком большой .xlsx → file-too-large, без загрузки', async () => {
    const { handler, apiClient } = createHandler();
    const ctx = ctxWith({ file_name: 'big.xlsx', file_id: 'fid', file_size: 50 * 1024 * 1024 });
    await handler.handle(ctx as never);
    expect(apiClient.intakeDocument).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('file-too-large');
  });
});
