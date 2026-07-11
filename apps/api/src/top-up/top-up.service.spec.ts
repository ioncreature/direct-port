import { NotFoundException } from '@nestjs/common';
import { UserRole } from '../database/entities/user.entity';
import { TopUpService } from './top-up.service';

function makeService(opts: { managerCompany: string | null; accountCompany: string | null }) {
  const request = {
    id: 'req-1',
    billingAccountId: 'acc-1',
    status: 'pending',
    positions: 100,
    amount: 100,
    currency: 'USD',
    pricePerPosition: 1,
    packageKey: 'p100',
    comment: null,
    createdAt: new Date(0),
    confirmedAt: null,
  };
  const repo = {
    findOne: jest.fn().mockResolvedValue(request),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const accountRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'acc-1', companyId: opts.accountCompany }),
  };
  const balance = {
    confirmTopUp: jest.fn().mockResolvedValue({ ...request, status: 'confirmed' }),
  };
  const conversations = {
    resolveManagerOrThrow: jest
      .fn()
      .mockResolvedValue({ id: 'm-1', role: UserRole.CUSTOMS, companyId: opts.managerCompany }),
  };
  const service = new TopUpService(
    repo as never,
    accountRepo as never,
    {} as never,
    balance as never,
    {} as never,
    conversations as never,
  );
  return { service, balance, repo };
}

describe('TopUpService — тенант-гейт менеджерских операций над заявкой', () => {
  it('менеджер своей компании подтверждает заявку → зачисление вызывается', async () => {
    const { service, balance } = makeService({ managerCompany: 'comp-A', accountCompany: 'comp-A' });
    await service.confirmByManager('req-1', '999');
    expect(balance.confirmTopUp).toHaveBeenCalledWith('req-1', 'm-1');
  });

  it('менеджер чужой компании → 404, зачисление не происходит', async () => {
    const { service, balance } = makeService({ managerCompany: 'comp-A', accountCompany: 'comp-B' });
    await expect(service.confirmByManager('req-1', '999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(balance.confirmTopUp).not.toHaveBeenCalled();
  });

  it('отмена чужой заявки менеджером → 404, статус не меняется', async () => {
    const { service, repo } = makeService({ managerCompany: 'comp-A', accountCompany: 'comp-B' });
    await expect(service.cancelByManager('req-1', '999')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
