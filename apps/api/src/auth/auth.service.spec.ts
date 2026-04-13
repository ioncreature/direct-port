import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '../database/entities/user.entity';

// Pre-compute all hashes once at module load to avoid repeated ~100ms hashSync in tests
const HASHED_PASSWORD = bcrypt.hashSync('correct-password', 10);
const HASHED_VALID_REFRESH = bcrypt.hashSync('valid-refresh-token', 10);
const HASHED_OTHER_TOKEN = bcrypt.hashSync('other-token', 10);
const HASHED_MY_REFRESH = bcrypt.hashSync('my-refresh-token', 10);

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-uuid-1',
    email: 'admin@directport.ru',
    passwordHash: HASHED_PASSWORD,
    role: UserRole.ADMIN,
    isActive: true,
    ...overrides,
  };
}

function makeRefreshToken(
  tokenHash: string,
  overrides: Record<string, any> = {},
) {
  return {
    id: 'token-1',
    tokenHash,
    expiresAt: new Date(Date.now() + 86400000),
    user: makeUser(),
    ...overrides,
  };
}

function createService(
  opts: {
    user?: ReturnType<typeof makeUser> | null;
    refreshTokens?: any[];
  } = {},
) {
  const user = opts.user !== undefined ? opts.user : makeUser();
  const refreshTokens = opts.refreshTokens ?? [];

  const usersRepo = {
    findOne: jest.fn().mockResolvedValue(user),
  };

  const refreshRepo = {
    find: jest.fn().mockResolvedValue(refreshTokens),
    save: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  };

  const jwtService = {
    sign: jest.fn().mockReturnValue('mock-access-token'),
  };

  const config = {
    get: jest.fn().mockReturnValue('15m'),
  };

  const service = new AuthService(
    usersRepo as any,
    refreshRepo as any,
    jwtService as any,
    config as any,
  );

  return { service, usersRepo, refreshRepo, jwtService };
}

describe('AuthService', () => {
  describe('login()', () => {
    it('возвращает токены при верных учётных данных', async () => {
      const { service } = createService();

      const result = await service.login('admin@directport.ru', 'correct-password');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.email).toBe('admin@directport.ru');
      expect(result.user.role).toBe(UserRole.ADMIN);
    });

    it('выбрасывает UnauthorizedException при неверном пароле', async () => {
      const { service } = createService();

      await expect(service.login('admin@directport.ru', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('выбрасывает UnauthorizedException если пользователь не найден', async () => {
      const { service } = createService({ user: null });

      await expect(service.login('unknown@test.ru', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('выбрасывает UnauthorizedException если пользователь деактивирован', async () => {
      const { service } = createService({ user: makeUser({ isActive: false }) });

      await expect(
        service.login('admin@directport.ru', 'correct-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('сохраняет хэш refresh-токена в БД', async () => {
      const { service, refreshRepo } = createService();

      await service.login('admin@directport.ru', 'correct-password');

      expect(refreshRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('JWT payload содержит sub, email и role', async () => {
      const { service, jwtService } = createService();

      await service.login('admin@directport.ru', 'correct-password');

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-uuid-1', email: 'admin@directport.ru', role: UserRole.ADMIN },
        { expiresIn: '15m' },
      );
    });
  });

  describe('refresh()', () => {
    it('выдаёт новые токены по валидному refresh-токену', async () => {
      const token = makeRefreshToken(HASHED_VALID_REFRESH);
      const { service, refreshRepo } = createService({ refreshTokens: [token] });

      const result = await service.refresh('valid-refresh-token');
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeTruthy();
      expect(refreshRepo.delete).toHaveBeenCalledWith('token-1');
    });

    it('выбрасывает UnauthorizedException для невалидного refresh-токена', async () => {
      const token = makeRefreshToken(HASHED_OTHER_TOKEN);
      const { service } = createService({ refreshTokens: [token] });

      await expect(service.refresh('wrong-token')).rejects.toThrow(UnauthorizedException);
    });

    it('выбрасывает UnauthorizedException если пользователь деактивирован', async () => {
      const token = makeRefreshToken(HASHED_VALID_REFRESH, {
        user: makeUser({ isActive: false }),
      });
      const { service } = createService({ refreshTokens: [token] });

      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(UnauthorizedException);
    });

    it('выбрасывает UnauthorizedException если нет токенов', async () => {
      const { service } = createService({ refreshTokens: [] });

      await expect(service.refresh('any-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout()', () => {
    it('удаляет matching refresh-токен из БД', async () => {
      const token = makeRefreshToken(HASHED_MY_REFRESH);
      const { service, refreshRepo } = createService({ refreshTokens: [token] });

      await service.logout('my-refresh-token');
      expect(refreshRepo.delete).toHaveBeenCalledWith('token-1');
    });

    it('не падает если токен не найден', async () => {
      const { service, refreshRepo } = createService({ refreshTokens: [] });

      await service.logout('non-existent-token');
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });
  });
});
