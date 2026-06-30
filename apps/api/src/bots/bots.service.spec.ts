import { BotsService } from './bots.service';

type Row = { companyId: string; tokenEnc: string };

function createService(rows: Row[], decrypt: (v: string) => string) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  const companiesRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const cipher = { decrypt: jest.fn().mockImplementation(decrypt) };
  const service = new BotsService(companiesRepo as never, cipher as never);
  return { service, qb };
}

describe('BotsService.listBots', () => {
  it('decrypts tokens and maps descriptors', async () => {
    const { service } = createService(
      [{ companyId: 'co-1', tokenEnc: 'enc1' }],
      (v) => `dec(${v})`,
    );
    expect(await service.listBots('client')).toEqual([
      { companyId: 'co-1', token: 'dec(enc1)' },
    ]);
  });

  it('skips companies whose token fails to decrypt (does not throw)', async () => {
    const { service } = createService(
      [
        { companyId: 'co-1', tokenEnc: 'good' },
        { companyId: 'co-2', tokenEnc: 'bad' },
      ],
      (v) => {
        if (v === 'bad') throw new Error('boom');
        return `dec(${v})`;
      },
    );
    expect(await service.listBots('manager')).toEqual([
      { companyId: 'co-1', token: 'dec(good)' },
    ]);
  });
});
