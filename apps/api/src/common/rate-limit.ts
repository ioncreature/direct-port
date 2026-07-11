import type Redis from 'ioredis';

/**
 * Fixed-window счётчик обращений в Redis: INCR ключа + EXPIRE NX (ставит TTL, только
 * если его ещё нет) одним pipeline — 1 RTT на хит. NX на каждом хите вместо «EXPIRE
 * при count === 1» закрывает дыру вечного ключа: если EXPIRE не выполнился после INCR,
 * ключ оставался без TTL — окно никогда не сбрасывалось, и после превышения лимита
 * IP/аккаунт получал 429 навсегда до ручной чистки Redis. Требует Redis ≥ 7.
 * Возвращает число обращений в текущем окне; null — если Redis недоступен или команда
 * не выполнилась (сигнал fail-open: вызывающий сам решает пропустить, а не блокировать
 * вход всем сразу). Общая механика лимитеров (AuthThrottleGuard, загрузки кабинета) —
 * ключ, лимит, код ошибки и логирование остаются на стороне вызывающего.
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
