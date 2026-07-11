import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { readNonNegIntEnv } from '../../common/env';
import { ErrorCode } from '../../common/error-codes';
import { fixedWindowHit } from '../../common/rate-limit';
import { REDIS_CLIENT } from '../../redis/redis.module';

const KEY_PREFIX = 'auth-rate:';
const windowSeconds = () => readNonNegIntEnv('AUTH_RATE_WINDOW_SECONDS', 300);
/** Максимум попыток на IP в окне. 0 — лимит выключен. */
const maxAttempts = () => readNonNegIntEnv('AUTH_RATE_MAX', 20);

/**
 * Fixed-window rate-limit для /auth/login и /auth/refresh по IP клиента: защита от
 * онлайн-перебора паролей (credential stuffing), которого раньше не было вовсе — единственной
 * ценой попытки был один bcrypt.compare, а компрометация super_admin означает доступ ко всем
 * тенантам. Раздельные окна на login и refresh (по req.path). Тот же Redis fixed-window, что
 * и лимитер загрузок кабинета. Недоступный Redis не блокирует вход всем сразу (self-DoS) —
 * fail-open с warn-логом. Настройки: AUTH_RATE_MAX (0 — выключить), AUTH_RATE_WINDOW_SECONDS.
 */
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private logger = new Logger(AuthThrottleGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const limit = maxAttempts();
    if (limit === 0) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = `${KEY_PREFIX}${req.path}:${clientIp(req)}`;
    const count = await fixedWindowHit(this.redis, key, windowSeconds());
    if (count === null) {
      this.logger.warn('Auth rate-limit check skipped (Redis unavailable)');
      return true;
    }
    if (count > limit) {
      throw new HttpException(
        { code: ErrorCode.AUTH_RATE_LIMITED, message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Реальный IP клиента: за прокси admin-web / ingress настоящий адрес — в X-Forwarded-For
 * (req.ip без trust proxy указывал бы на прокси, и лимит стал бы общим на всех). Берём
 * первый хоп XFF, иначе — req.ip.
 */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  return first ? first.split(',')[0].trim() : (req.ip ?? 'unknown');
}
