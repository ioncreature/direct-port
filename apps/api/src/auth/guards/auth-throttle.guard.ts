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
import { clientIp } from '../../common/client-ip';
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
