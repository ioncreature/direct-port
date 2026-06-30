import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BotsService } from './bots.service';

// --- listBots ---

type Row = { companyId: string; tokenEnc: string };

function createListService(rows: Row[], decrypt: (v: string) => string) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  const companiesRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const redis = { publish: jest.fn().mockResolvedValue(1) };
  const cipher = { decrypt: jest.fn().mockImplementation(decrypt) };
  return new BotsService(companiesRepo as never, redis as never, cipher as never);
}

describe('BotsService.listBots', () => {
  it('decrypts tokens and maps descriptors', async () => {
    const service = createListService([{ companyId: 'co-1', tokenEnc: 'enc1' }], (v) => `dec(${v})`);
    expect(await service.listBots('client')).toEqual([{ companyId: 'co-1', token: 'dec(enc1)' }]);
  });

  it('skips companies whose token fails to decrypt (does not throw)', async () => {
    const service = createListService(
      [
        { companyId: 'co-1', tokenEnc: 'good' },
        { companyId: 'co-2', tokenEnc: 'bad' },
      ],
      (v) => {
        if (v === 'bad') throw new Error('boom');
        return `dec(${v})`;
      },
    );
    expect(await service.listBots('manager')).toEqual([{ companyId: 'co-1', token: 'dec(good)' }]);
  });
});

// --- token management ---

function createMgmtService(
  opts: { exists?: boolean; isConfigured?: boolean; updateAffected?: number } = {},
) {
  const companiesRepo = {
    existsBy: jest.fn().mockResolvedValue(opts.exists ?? true),
    update: jest.fn().mockResolvedValue({ affected: opts.updateAffected ?? 1 }),
  };
  const redis = { publish: jest.fn().mockResolvedValue(1) };
  const cipher = {
    isConfigured: jest.fn().mockReturnValue(opts.isConfigured ?? true),
    encrypt: jest.fn().mockReturnValue('ENC'),
  };
  const service = new BotsService(companiesRepo as never, redis as never, cipher as never);
  return { service, companiesRepo, redis, cipher };
}

function mockGetMe(response: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ json: async () => response } as never);
}

describe('BotsService.setBotToken', () => {
  afterEach(() => jest.restoreAllMocks());

  it('validates via getMe, encrypts, updates and publishes upsert', async () => {
    const { service, companiesRepo, redis, cipher } = createMgmtService();
    mockGetMe({ ok: true, result: { username: 'co_bot' } });
    const res = await service.setBotToken('co-1', 'client', '123:ABCDEFGHIJKLMNOPQRST');
    expect(res).toEqual({ username: 'co_bot' });
    expect(cipher.encrypt).toHaveBeenCalledWith('123:ABCDEFGHIJKLMNOPQRST');
    expect(companiesRepo.update).toHaveBeenCalledWith(
      { id: 'co-1' },
      { clientBotTokenEnc: 'ENC', clientBotUsername: 'co_bot' },
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'bot-config-events',
      JSON.stringify({ companyId: 'co-1', kind: 'client', action: 'upsert' }),
    );
  });

  it('rejects when the encryption key is not configured', async () => {
    const { service } = createMgmtService({ isConfigured: false });
    await expect(service.setBotToken('co-1', 'client', 'x'.repeat(20))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404 when the company does not exist', async () => {
    const { service } = createMgmtService({ exists: false });
    await expect(service.setBotToken('missing', 'client', 'x'.repeat(20))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an invalid token (getMe ok=false)', async () => {
    const { service } = createMgmtService();
    mockGetMe({ ok: false });
    await expect(service.setBotToken('co-1', 'manager', 'x'.repeat(20))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BotsService.removeBotToken', () => {
  it('clears the columns and publishes remove', async () => {
    const { service, companiesRepo, redis } = createMgmtService();
    await service.removeBotToken('co-1', 'manager');
    expect(companiesRepo.update).toHaveBeenCalledWith(
      { id: 'co-1' },
      { managerBotTokenEnc: null, managerBotUsername: null },
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'bot-config-events',
      JSON.stringify({ companyId: 'co-1', kind: 'manager', action: 'remove' }),
    );
  });

  it('404 when the company does not exist', async () => {
    const { service } = createMgmtService({ updateAffected: 0 });
    await expect(service.removeBotToken('missing', 'client')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BotsService.getCompanyBots', () => {
  function withCompany(company: Record<string, unknown> | null) {
    const qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(company),
    };
    const companiesRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    return new BotsService(companiesRepo as never, {} as never, {} as never);
  }

  it('returns configured flags and usernames per kind', async () => {
    const service = withCompany({
      clientBotTokenEnc: 'enc',
      clientBotUsername: 'cli_bot',
      managerBotTokenEnc: null,
      managerBotUsername: null,
    });
    expect(await service.getCompanyBots('co-1')).toEqual({
      client: { configured: true, username: 'cli_bot' },
      manager: { configured: false, username: null },
    });
  });

  it('404 when the company is not found', async () => {
    await expect(withCompany(null).getCompanyBots('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
