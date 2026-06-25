import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Response } from 'express';

/**
 * Транслирует ошибки вызовов api (axios) в ответ кабинета: пробрасывает статус и тело
 * api как есть (404 на чужой документ остаётся 404, а не превращается в 500). Недоступность
 * api (нет response) → 502.
 */
@Catch(AxiosError)
export class AxiosExceptionFilter implements ExceptionFilter {
  private logger = new Logger(AxiosExceptionFilter.name);

  catch(err: AxiosError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = err.response?.status ?? 502;
    const body = err.response?.data ?? { statusCode: 502, message: 'Upstream API unavailable' };
    if (status >= 500) {
      this.logger.error(`Upstream api error ${status}: ${err.message}`);
    }
    res.status(status).json(body);
  }
}
