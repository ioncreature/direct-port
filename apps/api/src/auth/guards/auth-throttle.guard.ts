import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { readNonNegIntEnv } from '../../common/env';
import { ErrorCode } from '../../common/error-codes';
import { fixedWindowHit } from '../../common/rate-limit';
import { REDIS_CLIENT } from '../../redis/redis.module';

const KEY_PREFIX = 'auth-rate:';
const windowSeconds = () => readNonNegIntEnv('AUTH_RATE_WINDOW_SECONDS', 300);
/** Максимум попыток в окне — общий для IP- и идентификаторного измерений. 0 — лимит выключен. */
const maxAttempts = () => readNonNegIntEnv('AUTH_RATE_MAX', 20);

/**
 * Fixed-window rate-limit для /auth/login и /auth/refresh: защита от онлайн-перебора
 * паролей (credential stuffing), которого раньше не было вовсе — единственной ценой попытки
 * был один bcrypt.compare, а компрометация super_admin означает доступ ко всем тенантам.
 *
 * Два независимых измерения с раздельными окнами на login и refresh (по req.path):
 * - по IP клиента (clientIp — только доверенные источники, спуфимый XFF не читаем);
 * - по идентификатору учётки (credentialId — hash email/refresh-токена из body): не зависит
 *   от IP вовсе, поэтому держит и распределённый перебор одного аккаунта с многих адресов,
 *   и деградацию IP-измерения до общего бакета прокси. Обратная сторона — злоумышленник
 *   может на окно «выбить» известный ему email в 429; это осознанная цена per-account
 *   троттлинга (лучше придержать учётку, чем позволить её перебирать).
 *
 * Тот же Redis fixed-window, что и лимитер загрузок кабинета. Недоступный Redis не блокирует
 * вход всем сразу (self-DoS) — fail-open с warn-логом. Настройки: AUTH_RATE_MAX (0 —
 * выключить), AUTH_RATE_WINDOW_SECONDS.
 */
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private logger = new Logger(AuthThrottleGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const limit = maxAttempts();
    if (limit === 0) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const window = windowSeconds();
    const keys = [`${KEY_PREFIX}${req.path}:ip:${clientIp(req)}`];
    const credential = credentialId(req);
    if (credential) keys.push(`${KEY_PREFIX}${req.path}:id:${credential}`);
    // Измерения независимы — инкрементируем параллельно (попытка засчитывается в обоих).
    const counts = await Promise.all(
      keys.map((key) => fixedWindowHit(this.redis, key, window)),
    );
    if (counts.includes(null)) {
      this.logger.warn('Auth rate-limit check skipped (Redis unavailable)');
      return true;
    }
    if (counts.some((count) => (count ?? 0) > limit)) {
      throw new HttpException(
        { code: ErrorCode.AUTH_RATE_LIMITED, message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * IP клиента из доверенных источников. cf-connecting-ip ставит Cloudflare — первый хоп
 * цепочки (Cloudflare → Caddy → nginx → ingress → admin-web → api); для трафика через CF
 * подделать его нельзя. X-Forwarded-For намеренно НЕ читаем: хопы только аппендят справа,
 * поэтому первый элемент — это заголовок из запроса самого клиента; ротацией фейковых IP
 * в нём атакующий обнулял бы лимит, а подстановкой IP жертвы — выбивал бы её в 429.
 * Остаточные риски принимаем осознанно: при прямом доступе к origin (мимо CF)
 * cf-connecting-ip — клиентский заголовок, а без Cloudflare (dev/локалка) req.ip — это
 * прямой пир, т.е. общий бакет на всех за прокси. Оба случая безопасны по направлению
 * отказа для легитимных пользователей и компенсируются идентификаторным измерением
 * (credentialId), которое от IP не зависит вовсе.
 */
function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  const value = Array.isArray(cf) ? cf[0] : cf;
  return value?.trim() || req.ip || 'unknown';
}

/**
 * Идентификатор учётки из body: email для login, refresh-токен для refresh. В ключ кладём
 * hash, а не сырое значение — в Redis не попадают ни PII, ни живые токены. lowercase — для
 * нормализации email (для токена безвреден: коллизия только между токенами, различающимися
 * регистром).
 */
function credentialId(req: Request): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = body?.email ?? body?.refreshToken;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex').slice(0, 32);
}
