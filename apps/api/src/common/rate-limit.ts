import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ErrorCode } from './error-codes';

/**
 * Fixed-window счётчик обращений в Redis: INCR ключа + EXPIRE NX (ставит TTL, только
 * если его ещё нет) одним pipeline — 1 RTT на хит. NX на каждом хите вместо «EXPIRE
 * при count === 1» закрывает дыру вечного ключа: если EXPIRE не выполнился после INCR,
 * ключ оставался без TTL — окно никогда не сбрасывалось, и после превышения лимита
 * IP/аккаунт получал 429 навсегда до ручной чистки Redis. Требует Redis ≥ 7.
 * Возвращает число обращений в текущем окне; null — если Redis недоступен или команда
 * не выполнилась (сигнал fail-open: вызывающий сам решает пропустить, а не блокировать
 * вход всем сразу). Многомерным лимитерам (AuthThrottleGuard: IP × учётка) ключи, лимит
 * и код ошибки остаются на стороне вызывающего; одномерный сервисный кейс целиком
 * покрывает assertFixedWindowLimit ниже.
 */
export async function fixedWindowHit(
  redis: Redis,
  key: string,
  windowSeconds: number,
): Promise<number | null> {
  try {
    const results = await redis.pipeline().incr(key).expire(key, windowSeconds, 'NX').exec();
    const [incrErr, count] = results?.[0] ?? [new Error('empty pipeline result'), null];
    const [expireErr] = results?.[1] ?? [new Error('empty pipeline result')];
    // Ошибка любой из команд → fail-open, как при недоступном Redis: молча считать без
    // TTL нельзя — это вернуло бы вечный ключ, только уже с растущим счётчиком.
    if (incrErr || expireErr) return null;
    return Number(count);
  } catch {
    return null;
  }
}

/**
 * Готовый одномерный fixed-window лимитер: инкремент окна + 429 при превышении.
 * limit = 0 — лимит выключен; недоступный Redis — fail-open с warn-логом (лимитер
 * не должен блокировать легитимных пользователей при сбое инфраструктуры).
 * Используется сервисными лимитерами (загрузки кабинета, публичный калькулятор).
 */
export async function assertFixedWindowLimit(
  redis: Redis,
  logger: Logger,
  opts: {
    key: string;
    windowSeconds: number;
    limit: number;
    errorCode: ErrorCode;
    message: string;
  },
): Promise<void> {
  if (opts.limit === 0) return;
  const count = await fixedWindowHit(redis, opts.key, opts.windowSeconds);
  if (count === null) {
    logger.warn(`Rate-limit check skipped for ${opts.key} (Redis unavailable)`);
    return;
  }
  if (count > opts.limit) {
    throw new HttpException(
      { code: opts.errorCode, message: opts.message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
