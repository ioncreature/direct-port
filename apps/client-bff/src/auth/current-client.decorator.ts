import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ClientProfile } from './client-token.service';

/** Принципал кабинета из проверенного client-JWT (положен ClientAuthGuard'ом). */
export const CurrentClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientProfile => {
    return ctx.switchToHttp().getRequest().client;
  },
);
