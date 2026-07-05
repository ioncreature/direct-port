import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '../database/entities/user.entity';

// Pre-compute all hashes once at module load to avoid repeated ~100ms hashSync in tests
const HASHED_PASSWORD = bcrypt.hashSync('correct-password', 10);
const HASHED_VALID_REFRESH = bcrypt.hashSync('valid-refresh-token', 10);
const HASHED_OTHER_TOKEN = bcrypt.hashSync('other-token', 10);
const HASHED_MY_REFRESH = bcrypt.hashSync('my-refresh-token', 10);

const COMPANY_ID = 'company-uuid-1';

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-uuid-1',
    email: 'admin@directport.ru',
    passwordHash: HASHED_PASSWORD,
    role: UserRole.ADMIN,
    companyId: COMPANY_ID,
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
    /** Компания, в которую резолвится домен входа (по умолчанию — компания пользователя). */
    domainCompanyId?: string;
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

  const companiesService = {
    resolveCompanyIdByDomain: jest.fn().mockResolvedValue(opts.domainCompanyId ?? COMPANY_ID),
  };

  const service = new AuthService(
    usersRepo as any,
    refreshRepo as any,
    jwtService as any,
    config as any,
    companiesService as any,
  );

  return { service, usersRepo, refreshRepo, jwtService, companiesService };
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

    it('выбрасывает ForbiddenException (аккаунт отключён) для деактивированного при верном пароле', async () => {
      const { service } = createService({ user: makeUser({ isActive: false }) });

      await expect(
        service.login('admin@directport.ru', 'correct-password'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('деактивированному при НЕВЕРНОМ пароле отдаёт UnauthorizedException (не раскрывает аккаунт)', async () => {
      const { service } = createService({ user: makeUser({ isActive: false }) });

      await expect(service.login('admin@directport.ru', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
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

    it('JWT payload содержит sub, email, role и companyId', async () => {
      const { service, jwtService } = createService();

      await service.login('admin@directport.ru', 'correct-password');

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-uuid-1', email: 'admin@directport.ru', role: UserRole.ADMIN, companyId: COMPANY_ID },
        { expiresIn: '15m' },
      );
    });

    it('отклоняет вход, если домен принадлежит другой компании', async () => {
      const { service } = createService({ domainCompanyId: 'other-company' });

      await expect(
        service.login('admin@directport.ru', 'correct-password', 'other-tenant.ru'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('пропускает вход, когда компания пользователя совпадает с компанией домена', async () => {
      const { service, companiesService } = createService({ domainCompanyId: COMPANY_ID });

      const result = await service.login('admin@directport.ru', 'correct-password', 'acme.ru');

      expect(result.accessToken).toBe('mock-access-token');
      expect(companiesService.resolveCompanyIdByDomain).toHaveBeenCalledWith('acme.ru');
    });

    it('super_admin входит с любого домена (тенант-гейт не применяется)', async () => {
      const { service, companiesService } = createService({
        user: makeUser({ role: UserRole.SUPER_ADMIN, companyId: null }),
        domainCompanyId: 'any-company',
      });

      const result = await service.login('root@directport.ru', 'correct-password', 'whatever.ru');

      expect(result.accessToken).toBe('mock-access-token');
      expect(companiesService.resolveCompanyIdByDomain).not.toHaveBeenCalled();
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
