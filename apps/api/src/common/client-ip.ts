import type { Request } from 'express';

/**
 * IP клиента из доверенных источников. cf-connecting-ip ставит Cloudflare — первый хоп
 * цепочки (Cloudflare → Caddy → nginx → ingress → frontend → api); для трафика через CF
 * подделать его нельзя. X-Forwarded-For намеренно НЕ читаем: хопы только аппендят справа,
 * поэтому первый элемент — это заголовок из запроса самого клиента; ротацией фейковых IP
 * в нём атакующий обнулял бы rate-limit, а подстановкой IP жертвы — выбивал бы её в 429.
 * Остаточные риски принимаем осознанно: при прямом доступе к origin (мимо CF)
 * cf-connecting-ip — клиентский заголовок, а без Cloudflare (dev/локалка) req.ip — это
 * прямой пир, т.е. общий бакет на всех за прокси. Оба случая безопасны по направлению
 * отказа для легитимных пользователей.
 */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  const value = Array.isArray(cf) ? cf[0] : cf;
  return value?.trim() || req.ip || 'unknown';
}
