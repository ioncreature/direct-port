import { ArgumentsHost } from '@nestjs/common';
import { AxiosError } from 'axios';
import { AxiosExceptionFilter } from './axios-exception.filter';

function createFilter() {
  const filter = new AxiosExceptionFilter();
  // Глушим логгер, чтобы 5xx-кейсы не шумели в выводе тестов.
  (filter as any).logger = { error: jest.fn() };

  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { filter, res, host };
}

function makeAxiosError(status?: number, data?: unknown): AxiosError {
  const err = new AxiosError('Request failed');
  if (status !== undefined) {
    err.response = { status, data } as any;
  }
  return err;
}

describe('AxiosExceptionFilter', () => {
  it('404 из api остаётся 404 с телом api как есть (чужой ресурс не превращается в 500)', () => {
    const { filter, res, host } = createFilter();
    const body = { statusCode: 404, message: 'Document not found' };

    filter.catch(makeAxiosError(404, body), host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('401 из api (невалидная Telegram-подпись) пробрасывается как 401', () => {
    const { filter, res, host } = createFilter();
    const body = { statusCode: 401, message: 'Unauthorized' };

    filter.catch(makeAxiosError(401, body), host);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('недоступность api (нет response) → 502 с дефолтным телом', () => {
    const { filter, res, host } = createFilter();

    filter.catch(makeAxiosError(), host);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 502,
      message: 'Upstream API unavailable',
    });
  });

  it('5xx из api пробрасывается и логируется', () => {
    const { filter, res, host } = createFilter();
    const body = { statusCode: 500, message: 'Internal server error' };

    filter.catch(makeAxiosError(500, body), host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(body);
    expect((filter as any).logger.error).toHaveBeenCalled();
  });
});
