import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
import { Company } from '../database/entities/company.entity';
import { CompanyDomain } from '../database/entities/company-domain.entity';
import { Document } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { CompaniesService } from './companies.service';

const COMPANY_ID = '00000000-0000-0000-0000-0000000000aa';

function makeCompany(partial: Partial<Company> = {}): Company {
  return {
    id: COMPANY_ID,
    name: 'Acme',
    slug: null,
    theme: 'default',
    logoBytes: null,
    logoMime: null,
    logoHash: null,
    faviconBytes: null,
    faviconMime: null,
    faviconHash: null,
    domains: [],
    clientBotUsername: null,
    managerBotUsername: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  } as Company;
}

/**
 * Собирает сервис с моками репозиториев. counts задаёт, сколько привязанных сущностей
 * вернёт каждый .count() — этим управляем проверкой удаления/детали.
 */
function createService(counts: { users?: number; clients?: number; documents?: number } = {}) {
  const companiesRepo = {
    findOne: jest.fn().mockResolvedValue(makeCompany()),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repository<Company>;
  const domainsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
  } as unknown as Repository<CompanyDomain>;
  const usersRepo = {
    count: jest.fn().mockResolvedValue(counts.users ?? 0),
  } as unknown as Repository<User>;
  const telegramUsersRepo = {
    count: jest.fn().mockResolvedValue(counts.clients ?? 0),
  } as unknown as Repository<TelegramUser>;
  const documentsRepo = {
    count: jest.fn().mockResolvedValue(counts.documents ?? 0),
  } as unknown as Repository<Document>;

  const service = new CompaniesService(
    companiesRepo,
    domainsRepo,
    usersRepo,
    telegramUsersRepo,
    documentsRepo,
  );
  return { service, companiesRepo, domainsRepo };
}

describe('CompaniesService.remove', () => {
  it('удаляет полностью пустую компанию', async () => {
    const { service, companiesRepo } = createService();
    await service.remove(COMPANY_ID);
    expect(companiesRepo.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['пользователями', { users: 2 }],
    ['клиентами', { clients: 1 }],
    ['документами', { documents: 5 }],
  ])('запрещает удаление компании с %s', async (_label, counts) => {
    const { service, companiesRepo } = createService(counts);
    await expect(service.remove(COMPANY_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(companiesRepo.remove).not.toHaveBeenCalled();
  });
});

describe('CompaniesService.resolveBrandingByDomain', () => {
  it('привязанный домен → его компания, имя и тема, known=true', async () => {
    const { service, domainsRepo } = createService();
    (domainsRepo.findOne as jest.Mock).mockResolvedValue({
      domain: 'declarant.directport.ru',
      company: makeCompany({ theme: 'default' }),
    });
    const res = await service.resolveBrandingByDomain('declarant.directport.ru');
    expect(res.known).toBe(true);
    expect(res.theme).toBe('default');
    expect(res.name).toBe('Acme');
  });

  it('неизвестный домен → тема дефолтной компании, known=false, имя не светим', async () => {
    const { service, companiesRepo } = createService();
    // domainsRepo.findOne по умолчанию → null (домен не привязан); отдаём брендинг дефолтной.
    (companiesRepo.findOne as jest.Mock).mockResolvedValue(makeCompany({ theme: 'sky' }));
    const res = await service.resolveBrandingByDomain('unknown.example.com');
    expect(res.known).toBe(false);
    expect(res.theme).toBe('sky');
    expect(res.name).toBeNull();
  });

  it('домен привязан к дефолтной компании → имя «По умолчанию» не светим (null)', async () => {
    const { service, domainsRepo } = createService();
    (domainsRepo.findOne as jest.Mock).mockResolvedValue({
      domain: 'app.directport.ru',
      company: makeCompany({ id: DEFAULT_COMPANY_ID, name: 'По умолчанию' }),
    });
    const res = await service.resolveBrandingByDomain('app.directport.ru');
    expect(res.known).toBe(true);
    expect(res.name).toBeNull();
  });

  it('пустой домен → known=false (fallback на дефолт)', async () => {
    const { service } = createService();
    const res = await service.resolveBrandingByDomain(undefined);
    expect(res.known).toBe(false);
    expect(res.name).toBeNull();
  });
});

describe('CompaniesService.getDetail', () => {
  it('возвращает счётчики привязанных сущностей', async () => {
    const { service } = createService({ users: 3, clients: 4, documents: 7 });
    const detail = await service.getDetail(COMPANY_ID);
    expect(detail.counts).toEqual({ users: 3, clients: 4, documents: 7 });
    expect(detail.id).toBe(COMPANY_ID);
  });

  it('отдаёт logoHash как признак наличия логотипа', async () => {
    const { service, companiesRepo } = createService();
    (companiesRepo.findOne as jest.Mock).mockResolvedValue(
      makeCompany({ logoHash: 'abc123', logoMime: 'image/png' }),
    );
    const detail = await service.getDetail(COMPANY_ID);
    expect(detail.logoHash).toBe('abc123');
  });
});
