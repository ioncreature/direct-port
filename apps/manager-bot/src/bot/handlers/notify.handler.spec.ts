import { GrammyError } from 'grammy';
import {
  NotifyHandler,
  buildNotificationKeyboard,
  buildNotificationText,
  type ManagerNotification,
} from './notify.handler';

const base: ManagerNotification = {
  event: 'new_document',
  managerTelegramIds: ['999'],
  clientId: 'cli-1',
  clientName: 'Иван',
  clientTelegramId: '12345',
  assigned: false,
};

const ADMIN = 'https://admin.example';

describe('buildNotificationText', () => {
  it('new_document — заголовок + имя файла', () => {
    const t = buildNotificationText({ ...base, event: 'new_document', documentName: 'goods.xlsx' });
    expect(t).toContain('Новый файл');
    expect(t).toContain('goods.xlsx');
  });

  it('new_document с подписью к файлу показывает текст', () => {
    const t = buildNotificationText({
      ...base,
      event: 'new_document',
      documentName: 'goods.xlsx',
      text: 'срочно посчитайте',
    });
    expect(t).toContain('goods.xlsx');
    expect(t).toContain('срочно посчитайте');
  });

  it('client_message с текстом', () => {
    const t = buildNotificationText({ ...base, event: 'client_message', text: 'Привет' });
    expect(t).toContain('Привет');
  });

  it('client_message только с вложением', () => {
    const t = buildNotificationText({ ...base, event: 'client_message', attachmentType: 'photo' });
    expect(t).toContain('вложение: photo');
  });

  it('экранирует HTML в имени клиента и тексте', () => {
    const t = buildNotificationText({
      ...base,
      event: 'client_message',
      clientName: '<b>x</b>',
      text: 'a<b>',
    });
    expect(t).toContain('&lt;b&gt;');
    expect(t).not.toContain('<b>x</b>');
  });

  it('pipeline_done включает statusLabel', () => {
    const t = buildNotificationText({
      ...base,
      event: 'pipeline_done',
      documentName: 'd',
      statusLabel: 'Обработан',
    });
    expect(t).toContain('Расчёт готов');
    expect(t).toContain('Обработан');
  });

  it('pipeline_failed / review / rejected', () => {
    expect(buildNotificationText({ ...base, event: 'pipeline_failed' })).toContain('Ошибка');
    expect(buildNotificationText({ ...base, event: 'pipeline_review' })).toContain('проверки');
    expect(buildNotificationText({ ...base, event: 'pipeline_rejected' })).toContain('отклонён');
  });

  it('leads_report — заголовок и экранированный текст отчёта (без клиента)', () => {
    const t = buildNotificationText({
      event: 'leads_report',
      managerTelegramIds: ['1'],
      text: 'Найдено 8 лидов <топ>',
    });
    expect(t).toContain('Поиск лидов');
    expect(t).toContain('Найдено 8 лидов');
    expect(t).toContain('&lt;топ&gt;');
  });

  it('topup_request — сумма, позиции и призыв подтвердить', () => {
    const t = buildNotificationText({
      ...base,
      event: 'topup_request',
      topUpId: 'tu-1',
      positions: 100,
      amount: 100,
      currency: 'USD',
    });
    expect(t).toContain('Заявка на пополнение');
    expect(t).toContain('100 поз.');
    expect(t).toContain('100 USD');
  });
});

describe('buildNotificationKeyboard', () => {
  // grammy InlineKeyboard хранит кнопки в публичном inline_keyboard[][].
  const flat = (kb: ReturnType<typeof buildNotificationKeyboard>) =>
    kb.inline_keyboard.flat() as Array<{ text: string; callback_data?: string; url?: string }>;

  it('new_document (не назначен): Запустить + Взять + ссылка на документ', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'new_document', documentId: 'doc-1', assigned: false },
      ADMIN,
    );
    const buttons = flat(kb);
    expect(buttons.some((b) => b.text.includes('Запустить'))).toBe(true);
    expect(buttons.some((b) => b.text.includes('Взять'))).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'start:doc-1')).toBe(true);
    expect(buttons.some((b) => b.url?.includes('/documents/doc-1'))).toBe(true);
  });

  it('new_document (назначен): без кнопки Взять', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'new_document', documentId: 'doc-1', assigned: true },
      ADMIN,
    );
    expect(flat(kb).some((b) => b.text.includes('Взять'))).toBe(false);
  });

  it('client_message: Ответить + ссылка на клиента', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'client_message', assigned: true },
      ADMIN,
    );
    const buttons = flat(kb);
    expect(buttons.some((b) => b.callback_data === 'reply:cli-1')).toBe(true);
    expect(buttons.some((b) => b.url?.includes('/telegram-users/cli-1'))).toBe(true);
  });

  it('pipeline_done без готового результата: только ссылка в админку', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'pipeline_done', documentId: 'doc-1' },
      ADMIN,
    );
    const buttons = flat(kb);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].url).toContain('/documents/doc-1');
  });

  it('pipeline_done с resultReady: кнопка «Отправить клиенту» + ссылка', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'pipeline_done', documentId: 'doc-1', resultReady: true },
      ADMIN,
    );
    const buttons = flat(kb);
    expect(buttons.some((b) => b.callback_data === 'send:doc-1')).toBe(true);
    expect(buttons.some((b) => b.url?.includes('/documents/doc-1'))).toBe(true);
  });

  it('leads_report: ссылка на раздел лидов', () => {
    const kb = buildNotificationKeyboard(
      { event: 'leads_report', managerTelegramIds: ['1'] },
      ADMIN,
    );
    expect(flat(kb).some((b) => b.url?.includes('/leads'))).toBe(true);
  });

  it('topup_request: кнопки подтвердить/отклонить + ссылка на клиента', () => {
    const kb = buildNotificationKeyboard(
      { ...base, event: 'topup_request', topUpId: 'tu-1' },
      ADMIN,
    );
    const buttons = flat(kb);
    expect(buttons.some((b) => b.callback_data === 'confirm-topup:tu-1')).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'cancel-topup:tu-1')).toBe(true);
    expect(buttons.some((b) => b.url?.includes('/telegram-users/cli-1'))).toBe(true);
  });
});

describe('NotifyHandler.process — ретраи доставки', () => {
  function createHandler(sendMessage: jest.Mock) {
    const config = { get: jest.fn().mockReturnValue('test-token') };
    const handler = new NotifyHandler(config as never);
    (handler as unknown as { tgApi: { sendMessage: jest.Mock } }).tgApi = { sendMessage };
    return handler;
  }

  const jobWith = (managerTelegramIds: string[]) =>
    ({ data: { ...base, managerTelegramIds } }) as never;

  const transientError = () => new Error('network down');
  const permanentError = () =>
    new GrammyError(
      'blocked',
      { ok: false, error_code: 403, description: 'Forbidden: bot was blocked' },
      'sendMessage',
      {},
    );

  it('частичный успех: job завершается, ретрая нет (иначе дубли получившим)', async () => {
    const sendMessage = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(transientError());
    await expect(createHandler(sendMessage).process(jobWith(['1', '2']))).resolves.toBeUndefined();
  });

  it('ноль доставок + временная ошибка: бросает, чтобы BullMQ ретраил', async () => {
    const sendMessage = jest.fn().mockRejectedValue(transientError());
    await expect(createHandler(sendMessage).process(jobWith(['1', '2']))).rejects.toThrow(
      'network down',
    );
  });

  it('ноль доставок, но все ошибки неисправимые (бот заблокирован): не ретраит', async () => {
    const sendMessage = jest.fn().mockRejectedValue(permanentError());
    await expect(createHandler(sendMessage).process(jobWith(['1']))).resolves.toBeUndefined();
  });
});
