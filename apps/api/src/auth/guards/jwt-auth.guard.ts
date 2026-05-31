import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { timingSafeEqual } from 'node:crypto';
import { IS_INTERNAL_KEY } from '../decorators/internal.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const internalKeyValid = this.isInternalKeyValid(request.headers['x-internal-key']);

    // @Internal-маршруты доступны ТОЛЬКО по валидному X-Internal-Key — JWT любого
    // пользователя для них не принимается (закрывает доступ к *-internal извне).
    const isInternal = this.reflector.getAllAndOverride<boolean>(IS_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isInternal) return internalKeyValid;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Обычные маршруты: доверенный сервис (бот) по ключу либо пользователь по JWT.
    if (internalKeyValid) return true;
    return super.canActivate(context);
  }

  /**
   * Constant-time сравнение X-Internal-Key: обычный === завершается на первом
   * различии и теоретически утекает ключ по времени ответа. Пустой/незаданный
   * ключ окружения никогда не проходит.
   */
  private isInternalKeyValid(provided: unknown): boolean {
    const expected = process.env.API_INTERNAL_KEY;
    if (!expected || typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
