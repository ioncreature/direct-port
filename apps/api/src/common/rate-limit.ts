import type Redis from 'ioredis';

/**
 * Fixed-window счётчик обращений в Redis: INCR ключа + EXPIRE на первом хопе окна.
 * Возвращает число обращений в текущем окне; null — если Redis недоступен (сигнал
 * fail-open: вызывающий сам решает пропустить, а не блокировать вход всем сразу).
 * Общая механика лимитеров (AuthThrottleGuard, загрузки кабинета) — ключ, лимит,
 * код ошибки и логирование остаются на стороне вызывающего.
 */
export async function fixedWindowHit(
  redis: Redis,
  key: string,
  windowSeconds: number,
): Promise<number | null> {
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count;
  } catch {
    return null;
  }
}
