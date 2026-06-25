import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ClientTokenService } from './client-token.service';

/**
 * Гард неймспейса /client/* (кроме /client/auth/*). Берёт Bearer access-токен,
 * проверяет подпись/тип и кладёт принципал в req.client. Владелец (accountId)
 * берётся ТОЛЬКО отсюда — контроллеры не доверяют id из тела/пути запроса.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private tokens: ClientTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { client?: unknown }>();
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    req.client = this.tokens.verifyAccess(header.slice('Bearer '.length));
    return true;
  }
}
