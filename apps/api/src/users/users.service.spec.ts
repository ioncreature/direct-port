import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Actor } from '../common/tenant/actor-context';
import { User, UserRole } from '../database/entities/user.entity';
import { UsersService } from './users.service';

const superAdmin: Actor = { id: 'sa', role: UserRole.SUPER_ADMIN, companyId: null };
const companyAdmin: Actor = { id: 'a', role: UserRole.ADMIN, companyId: 'comp-1' };

function makeUser(partial: Partial<User>): User {
  return {
    id: 'u1',
    email: 'u@x.io',
    passwordHash: 'hash',
    role: UserRole.ADMIN,
    companyId: 'comp-1',
    company: null,
    isActive: true,
    managerTelegramId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    refreshTokens: [],
    ...partial,
  } as User;
}

function makeRepo(overrides: Partial<Record<keyof Repository<User>, unknown>> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    create: jest.fn().mockImplementation((d) => d),
    save: jest.fn().mockImplementation(async (u) => ({ id: 'new-id', ...u })),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Repository<User>;
}

const query = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' as const };

describe('UsersService.findAll', () => {
  it('подставляет companyName из relation и не отдаёт наружу passwordHash/company', async () => {
    const repo = makeRepo({
      findAndCount: jest
        .fn()
        .mockResolvedValue([[makeUser({ company: { id: 'comp-1', name: 'Acme' } as User['company'] })], 1]),
    });
    const service = new UsersService(repo);

    const res = await service.findAll(query as never, superAdmin);

    expect(res.data[0].companyName).toBe('Acme');
    expect('passwordHash' in res.data[0]).toBe(false);
    expect('company' in res.data[0]).toBe(false);
  });

  it('companyName=null для пользователя без компании (super_admin)', async () => {
    const repo = makeRepo({
      findAndCount: jest
        .fn()
        .mockResolvedValue([[makeUser({ role: UserRole.SUPER_ADMIN, companyId: null, company: null })], 1]),
    });
    const service = new UsersService(repo);

    const res = await service.findAll(query as never, superAdmin);

    expect(res.data[0].companyName).toBeNull();
  });
});

describe('UsersService.create — выбор роли и компании по актору', () => {
  it('super_admin создаёт admin в указанной компании', async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);

    await service.create(
      { email: 'n@x.io', password: 'secret1', role: UserRole.ADMIN, companyId: 'comp-9' },
      superAdmin,
    );

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.ADMIN, companyId: 'comp-9' }),
    );
  });

  it('super_admin без companyId для admin/customs → BadRequest', async () => {
    const service = new UsersService(makeRepo());
    await expect(
      service.create({ email: 'n@x.io', password: 'secret1', role: UserRole.CUSTOMS }, superAdmin),
    ).rejects.toThrow(BadRequestException);
  });

  it('super_admin создаёт super_admin без компании (companyId=null)', async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);

    await service.create(
      { email: 'n@x.io', password: 'secret1', role: UserRole.SUPER_ADMIN, companyId: 'ignored' },
      superAdmin,
    );

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.SUPER_ADMIN, companyId: null }),
    );
  });

  it('admin компании создаёт в своей компании, dto.companyId игнорируется', async () => {
    const repo = makeRepo();
    const service = new UsersService(repo);

    await service.create(
      { email: 'n@x.io', password: 'secret1', role: UserRole.CUSTOMS, companyId: 'other' },
      companyAdmin,
    );

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'comp-1' }));
  });

  it('admin компании не может создать super_admin → Forbidden', async () => {
    const service = new UsersService(makeRepo());
    await expect(
      service.create(
        { email: 'n@x.io', password: 'secret1', role: UserRole.SUPER_ADMIN },
        companyAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('UsersService.update — смена компании', () => {
  it('super_admin переносит admin/customs в другую компанию', async () => {
    const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(makeUser({ companyId: 'comp-1' })) });
    const service = new UsersService(repo);

    await service.update('u1', { companyId: 'comp-2' }, superAdmin);

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'comp-2' }));
  });

  it('admin компании не может менять компанию пользователя → Forbidden', async () => {
    const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(makeUser({ companyId: 'comp-1' })) });
    const service = new UsersService(repo);

    await expect(service.update('u1', { companyId: 'comp-2' }, companyAdmin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('нельзя задать компанию super_admin-пользователю → BadRequest', async () => {
    const repo = makeRepo({
      findOne: jest.fn().mockResolvedValue(makeUser({ role: UserRole.SUPER_ADMIN, companyId: null })),
    });
    const service = new UsersService(repo);

    await expect(service.update('u1', { companyId: 'comp-2' }, superAdmin)).rejects.toThrow(
      BadRequestException,
    );
  });
});
