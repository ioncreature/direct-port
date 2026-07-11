import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../database/entities/user.entity';
import { ManagerLinkService } from './manager-link.service';

function makeService(user: { id: string; companyId: string | null } | null) {
  const redis = { set: jest.fn().mockResolvedValue('OK'), getdel: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('default_bot') };
  const usersRepo = { findOne: jest.fn().mockResolvedValue(user) };
  const companiesRepo = {
    findOne: jest.fn().mockResolvedValue({ managerBotUsername: 'company_bot' }),
  };
  const service = new ManagerLinkService(
    redis as never,
    config as never,
    usersRepo as never,
    companiesRepo as never,
  );
  return { service, redis, companiesRepo };
}

const ADMIN_A = { id: 'a', role: UserRole.ADMIN, companyId: 'comp-A' };
const SUPER = { id: 's', role: UserRole.SUPER_ADMIN, companyId: null };

describe('ManagerLinkService.createToken (тенант-гейт)', () => {
  it('менеджер своей компании → выдаёт токен и deep-link на бота компании', async () => {
    const { service, redis } = makeService({ id: 'mgr-1', companyId: 'comp-A' });
    const res = await service.createToken('mgr-1', ADMIN_A);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('mgr-link:'),
      'mgr-1',
      'EX',
      expect.any(Number),
    );
    expect(res.deepLink).toContain('https://t.me/company_bot?start=');
  });

  it('менеджер чужой компании → 404, токен не выпускается', async () => {
    const { service, redis } = makeService({ id: 'mgr-2', companyId: 'comp-B' });
    await expect(service.createToken('mgr-2', ADMIN_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('несуществующий пользователь → 404', async () => {
    const { service, redis } = makeService(null);
    await expect(service.createToken('ghost', ADMIN_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('super_admin → может выпустить токен для любой компании', async () => {
    const { service, redis } = makeService({ id: 'mgr-3', companyId: 'comp-B' });
    await service.createToken('mgr-3', SUPER);
    expect(redis.set).toHaveBeenCalled();
  });
});
