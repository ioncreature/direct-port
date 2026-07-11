import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientProfile, ClientTokenService } from './client-token.service';

// Секрет только для тестов — реальный env не читается (ConfigService замокан).
const TEST_SECRET = 'test-client-jwt-secret';

const PROFILE: ClientProfile = {
  accountId: 'acc-uuid-1',
  telegramUserId: 'tgu-uuid-1',
  name: 'Иван',
  username: 'ivan_test',
  photoUrl: 'https://t.me/i/userpic/ivan.jpg',
};

function createService(ttl: { access?: string; refresh?: string } = {}) {
  const jwt = new JwtService({ secret: TEST_SECRET });
  const config = {
    get: jest.fn((key: string, def: string) => {
      if (key === 'CLIENT_JWT_ACCESS_TTL') return ttl.access ?? def;
      if (key === 'CLIENT_JWT_REFRESH_TTL') return ttl.refresh ?? def;
      return def;
    }),
  };
  const service = new ClientTokenService(jwt, config as any);
  return { service, jwt };
}

describe('ClientTokenService', () => {
  describe('issueTokens + verifyAccess', () => {
    it('выпущенный access-токен верифицируется и восстанавливает принципал (sub=billingAccountId)', () => {
      const { service, jwt } = createService();
      const { accessToken } = service.issueTokens(PROFILE);

      // sub в JWT — это billingAccountId, tgu — telegramUserId.
      const raw = jwt.decode<Record<string, unknown>>(accessToken);
      expect(raw.sub).toBe(PROFILE.accountId);
      expect(raw.tgu).toBe(PROFILE.telegramUserId);
      expect(raw.typ).toBe('access');

      expect(service.verifyAccess(accessToken)).toEqual(PROFILE);
    });

    it('null-поля профиля переживают roundtrip (не превращаются в undefined)', () => {
      const { service } = createService();
      const bare: ClientProfile = {
        accountId: 'acc-2',
        telegramUserId: 'tgu-2',
        name: null,
        username: null,
        photoUrl: null,
      };
      const { accessToken } = service.issueTokens(bare);
      expect(service.verifyAccess(accessToken)).toEqual(bare);
    });

    it('refresh-токен помечен typ=refresh и НЕ принимается как access', () => {
      const { service, jwt } = createService();
      const { refreshToken } = service.issueTokens(PROFILE);

      expect(jwt.decode<Record<string, unknown>>(refreshToken).typ).toBe('refresh');
      expect(() => service.verifyAccess(refreshToken)).toThrow(UnauthorizedException);
    });

    it('истёкший access-токен отвергается', () => {
      const { service } = createService({ access: '-1s' });
      const { accessToken } = service.issueTokens(PROFILE);
      expect(() => service.verifyAccess(accessToken)).toThrow(UnauthorizedException);
    });

    it('токен, подписанный чужим секретом, отвергается', () => {
      const { service } = createService();
      const foreignJwt = new JwtService({ secret: 'another-secret' });
      const forged = foreignJwt.sign(
        { sub: 'acc-uuid-1', tgu: 'tgu-uuid-1', typ: 'access' },
        { expiresIn: '15m' },
      );
      expect(() => service.verifyAccess(forged)).toThrow(UnauthorizedException);
    });

    it('мусор вместо токена отвергается', () => {
      const { service } = createService();
      expect(() => service.verifyAccess('not-a-jwt')).toThrow(UnauthorizedException);
    });
  });

  describe('rotate', () => {
    it('по валидному refresh выдаёт новую рабочую пару с тем же принципалом', () => {
      const { service } = createService();
      const { refreshToken } = service.issueTokens(PROFILE);

      const rotated = service.rotate(refreshToken);
      expect(rotated.accessToken).toEqual(expect.any(String));
      expect(rotated.refreshToken).toEqual(expect.any(String));
      // Новый access восстанавливает исходный профиль, включая accountId.
      expect(service.verifyAccess(rotated.accessToken)).toEqual(PROFILE);
      // И новый refresh тоже ротируется дальше (stateless-цепочка).
      expect(() => service.rotate(rotated.refreshToken)).not.toThrow();
    });

    it('access-токен не принимается вместо refresh', () => {
      const { service } = createService();
      const { accessToken } = service.issueTokens(PROFILE);
      expect(() => service.rotate(accessToken)).toThrow(UnauthorizedException);
    });

    it('истёкший refresh отвергается', () => {
      const { service } = createService({ refresh: '-1s' });
      const { refreshToken } = service.issueTokens(PROFILE);
      expect(() => service.rotate(refreshToken)).toThrow(UnauthorizedException);
    });

    it('refresh с невалидной подписью отвергается', () => {
      const { service } = createService();
      const foreignJwt = new JwtService({ secret: 'another-secret' });
      const forged = foreignJwt.sign(
        { sub: 'acc-uuid-1', tgu: 'tgu-uuid-1', typ: 'refresh' },
        { expiresIn: '30d' },
      );
      expect(() => service.rotate(forged)).toThrow(UnauthorizedException);
    });
  });
});
