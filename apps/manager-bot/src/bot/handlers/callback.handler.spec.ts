import { describeCallbackError } from './callback.handler';

describe('describeCallbackError', () => {
  it('конфликт claim (код или 409)', () => {
    expect(describeCallbackError({ response: { status: 409 } })).toContain('уже взял');
    expect(
      describeCallbackError({ response: { data: { code: 'CLIENT_ALREADY_CLAIMED' } } }),
    ).toContain('уже взял');
  });

  it('менеджер не привязан (код или 403)', () => {
    expect(describeCallbackError({ response: { status: 403 } })).toContain('не привязан');
    expect(
      describeCallbackError({ response: { data: { code: 'MANAGER_NOT_LINKED' } } }),
    ).toContain('не привязан');
  });

  it('документ не в статусе INTAKE', () => {
    expect(
      describeCallbackError({ response: { data: { code: 'INVALID_STATUS_FOR_START' } } }),
    ).toContain('уже запущен');
  });

  it('расчёт не готов к отправке (DOWNLOAD_NOT_AVAILABLE)', () => {
    expect(
      describeCallbackError({ response: { data: { code: 'DOWNLOAD_NOT_AVAILABLE' } } }),
    ).toContain('не готов');
  });

  it('заявка на пополнение: не найдена / уже подтверждена / отменена', () => {
    expect(
      describeCallbackError({ response: { data: { code: 'TOPUP_NOT_FOUND' } } }),
    ).toContain('не найдена');
    expect(
      describeCallbackError({ response: { data: { code: 'TOPUP_ALREADY_CONFIRMED' } } }),
    ).toContain('уже подтверждена');
    expect(
      describeCallbackError({ response: { data: { code: 'TOPUP_NOT_PENDING' } } }),
    ).toContain('уже отменена');
  });

  it('неизвестная ошибка → общий текст', () => {
    expect(describeCallbackError(new Error('boom'))).toBe('Не удалось выполнить действие');
  });
});
