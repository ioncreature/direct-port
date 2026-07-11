import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PortalController } from '../portal/portal.controller';
import { AuthController } from './auth.controller';
import { ClientAuthGuard } from './client-auth.guard';
import { ClientProfile, ClientTokenService } from './client-token.service';

const TEST_SECRET = 'test-client-jwt-secret';

const PROFILE: ClientProfile = {
  accountId: 'acc-uuid-1',
  telegramUserId: 'tgu-uuid-1',
  name: 'Иван',
  username: 'ivan_test',
  photoUrl: null,
};

function createGuard() {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const config = { get: jest.fn((_key: string, def: string) => def) };
  const tokens = new ClientTokenService(jwt, config as any);
  return { guard: new ClientAuthGuard(tokens), tokens };
}

/** Минимальный мок ExecutionContext: только switchToHttp().getRequest(). */
function makeContext(headers: Record<string, unknown>) {
  const req: { headers: Record<string, unknown>; client?: unknown } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('ClientAuthGuard', () => {
  it('валидный Bearer access-токен пропускает и кладёт принципал в req.client', () => {
    const { guard, tokens } = createGuard();
    const { accessToken } = tokens.issueTokens(PROFILE);
    const { context, req } = makeContext({ authorization: `Bearer ${accessToken}` });

    expect(guard.canActivate(context)).toBe(true);
    expect(req.client).toEqual(PROFILE);
    expect((req.client as ClientProfile).accountId).toBe('acc-uuid-1');
  });

  it('отсутствие заголовка Authorization → 401', () => {
    const { guard } = createGuard();
    const { context } = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('не-Bearer схема → 401', () => {
    const { guard } = createGuard();
    const { context } = makeContext({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('битый токен → 401, req.client не заполняется', () => {
    const { guard } = createGuard();
    const { context, req } = makeContext({ authorization: 'Bearer garbage.token.here' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(req.client).toBeUndefined();
  });

  it('refresh-токен вместо access → 401 (typ проверяется)', () => {
    const { guard, tokens } = createGuard();
    const { refreshToken } = tokens.issueTokens(PROFILE);
    const { context } = makeContext({ authorization: `Bearer ${refreshToken}` });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('массив заголовков (нестроковый authorization) → 401', () => {
    const { guard, tokens } = createGuard();
    const { accessToken } = tokens.issueTokens(PROFILE);
    const { context } = makeContext({ authorization: [`Bearer ${accessToken}`] });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  describe('привязка гарда к контроллерам', () => {
    // GUARDS_METADATA ('__guards__') — ключ, под которым @UseGuards хранит гарды класса.
    it('PortalController защищён ClientAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', PortalController);
      expect(guards).toContain(ClientAuthGuard);
    });

    it('AuthController (в т.ч. /client/auth/*) не под гардом — это точка получения сессии', () => {
      const guards = Reflect.getMetadata('__guards__', AuthController);
      expect(guards).toBeUndefined();
    });
  });
});
