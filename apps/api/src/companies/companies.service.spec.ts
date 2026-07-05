import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
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
  const domainsRepo = {} as unknown as Repository<CompanyDomain>;
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
  return { service, companiesRepo };
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

describe('CompaniesService.getDetail', () => {
  it('возвращает счётчики привязанных сущностей', async () => {
    const { service } = createService({ users: 3, clients: 4, documents: 7 });
    const detail = await service.getDetail(COMPANY_ID);
    expect(detail.counts).toEqual({ users: 3, clients: 4, documents: 7 });
    expect(detail.id).toBe(COMPANY_ID);
  });
});
