import { BadRequestException } from '@nestjs/common';
import { BillingAccount } from '../database/entities/billing-account.entity';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { ClientBalanceService } from './client-balance.service';

function makeDoc(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    telegramUserId: 'tg-1',
    originalFileName: 'file.xlsx',
    status: DocumentStatus.PROCESSED,
    rowCount: 3,
    balanceChargedAmount: 0,
    resultData: [
      { calculationStatus: 'exact' },
      { calculationStatus: 'partial' },
      { calculationStatus: 'needs_info' },
    ],
    ...overrides,
  });
  return doc;
}

function makeService(
  opts: {
    balance?: number;
    docChargedInTx?: number;
    accountExists?: boolean;
    tgUserExists?: boolean;
  } = {},
) {
  const balance = opts.balance ?? 0;
  const em = {
    findOne: jest.fn((entity: unknown) => {
      if (entity === BillingAccount) {
        return Promise.resolve(opts.accountExists === false ? null : { id: 'acc-1', balance });
      }
      if (entity === Document) {
        return Promise.resolve({ id: 'doc-1', balanceChargedAmount: opts.docChargedInTx ?? 0 });
      }
      return Promise.resolve(null);
    }),
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const accountRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'acc-1', balance }),
    manager: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)) },
  };
  const txRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
  const tgUserRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        opts.tgUserExists === false ? null : { id: 'tg-1', billingAccountId: 'acc-1' },
      ),
  };
  const service = new ClientBalanceService(
    accountRepo as never,
    txRepo as never,
    tgUserRepo as never,
  );
  return { service, em, accountRepo, txRepo, tgUserRepo };
}

describe('ClientBalanceService.getBalance', () => {
  it('возвращает баланс аккаунта', async () => {
    const { service } = makeService({ balance: 7 });
    expect(await service.getBalance('acc-1')).toBe(7);
  });

  it('нет аккаунта → 0', async () => {
    const { service, accountRepo } = makeService();
    accountRepo.findOne.mockResolvedValueOnce(null);
    expect(await service.getBalance('acc-1')).toBe(0);
  });
});

describe('ClientBalanceService.reserveProcessing', () => {
  it('документ без клиента → разрешено, транзакция не открывается', async () => {
    const { service, tgUserRepo, accountRepo } = makeService();
    const gate = await service.reserveProcessing(makeDoc({ telegramUserId: null }));
    expect(gate.allowed).toBe(true);
    expect(gate.need).toBe(0);
    expect(tgUserRepo.findOne).not.toHaveBeenCalled();
    expect(accountRepo.manager.transaction).not.toHaveBeenCalled();
  });

  it('баланса хватает → удерживает need под локом: charge в ledger + balanceChargedAmount', async () => {
    const { service, em } = makeService({ balance: 20, docChargedInTx: 0 });
    const doc = makeDoc({ rowCount: 20 });
    const gate = await service.reserveProcessing(doc);

    expect(gate).toEqual({ allowed: true, need: 20, available: 0, previousCharged: 0 });
    expect(em.update).toHaveBeenCalledWith(BillingAccount, { id: 'acc-1' }, { balance: 0 });
    expect(em.update).toHaveBeenCalledWith(
      Document,
      { id: 'doc-1' },
      { balanceChargedAmount: 20 },
    );
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: -20, type: 'charge', documentId: 'doc-1' }),
    );
    expect(doc.balanceChargedAmount).toBe(20);
  });

  it('баланса не хватает → allowed=false, ничего не списано', async () => {
    const { service, em } = makeService({ balance: 5, docChargedInTx: 0 });
    const gate = await service.reserveProcessing(makeDoc({ rowCount: 20 }));
    expect(gate).toEqual({ allowed: false, need: 20, available: 5, previousCharged: 0 });
    expect(em.update).not.toHaveBeenCalled();
    expect(em.insert).not.toHaveBeenCalled();
  });

  it('сверяет уже списанное ПОД ЛОКОМ (из БД, не из doc): need = rowCount − charged', async () => {
    const { service, em } = makeService({ balance: 1, docChargedInTx: 18 });
    // In-memory значение отстало (0) — источник истины docRow из транзакции (18).
    const gate = await service.reserveProcessing(
      makeDoc({ rowCount: 20, balanceChargedAmount: 0 }),
    );
    expect(gate).toEqual({ allowed: false, need: 2, available: 1, previousCharged: 18 });
    expect(em.insert).not.toHaveBeenCalled();
  });

  it('всё уже удержано (need=0) → allowed без записи даже при нулевом балансе', async () => {
    const { service, em } = makeService({ balance: 0, docChargedInTx: 20 });
    const gate = await service.reserveProcessing(makeDoc({ rowCount: 20 }));
    expect(gate).toEqual({ allowed: true, need: 0, available: 0, previousCharged: 20 });
    expect(em.update).not.toHaveBeenCalled();
    expect(em.insert).not.toHaveBeenCalled();
  });
});

describe('ClientBalanceService.releaseReservation', () => {
  it('возвращает удержанное до previousCharged (adjustment в ledger)', async () => {
    const { service, em } = makeService({ balance: 0, docChargedInTx: 20 });
    const doc = makeDoc({ balanceChargedAmount: 20 });
    await service.releaseReservation(doc, 2);

    expect(em.update).toHaveBeenCalledWith(BillingAccount, { id: 'acc-1' }, { balance: 18 });
    expect(em.update).toHaveBeenCalledWith(
      Document,
      { id: 'doc-1' },
      { balanceChargedAmount: 2 },
    );
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: 18, type: 'adjustment' }),
    );
    expect(doc.balanceChargedAmount).toBe(2);
  });

  it('нечего возвращать (charged == target) → без записи', async () => {
    const { service, em } = makeService({ balance: 0, docChargedInTx: 2 });
    await service.releaseReservation(makeDoc({ balanceChargedAmount: 2 }), 2);
    expect(em.insert).not.toHaveBeenCalled();
  });

  it('сбой транзакции не пробрасывается (best-effort)', async () => {
    const { service, accountRepo } = makeService();
    accountRepo.manager.transaction.mockRejectedValueOnce(new Error('db down') as never);
    await expect(service.releaseReservation(makeDoc(), 0)).resolves.toBeUndefined();
  });
});

describe('ClientBalanceService.settle', () => {
  it('документ без клиента → транзакция не открывается', async () => {
    const { service, accountRepo } = makeService();
    const doc = makeDoc({ telegramUserId: null });
    await service.settle(doc);
    expect(accountRepo.manager.transaction).not.toHaveBeenCalled();
    expect(doc.balanceChargedAmount).toBe(0);
  });

  it('неоплачиваемый статус (PENDING) → списания нет', async () => {
    const { service, accountRepo } = makeService();
    await service.settle(makeDoc({ status: DocumentStatus.PENDING }));
    expect(accountRepo.manager.transaction).not.toHaveBeenCalled();
  });

  it('списывает только успешные позиции (exact/partial), не needs_info/error', async () => {
    const { service, em } = makeService({ balance: 50, docChargedInTx: 0 });
    const doc = makeDoc(); // 2 успешных (exact, partial) + 1 needs_info
    await service.settle(doc);

    // Баланс аккаунта уменьшается на 2
    expect(em.update).toHaveBeenCalledWith(BillingAccount, { id: 'acc-1' }, { balance: 48 });
    expect(em.update).toHaveBeenCalledWith(Document, { id: 'doc-1' }, { balanceChargedAmount: 2 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billingAccountId: 'acc-1',
        delta: -2,
        type: 'charge',
        balanceAfter: 48,
        documentId: 'doc-1',
      }),
    );
    expect(doc.balanceChargedAmount).toBe(2);
  });

  it('идемпотентно: повторный settle с тем же числом успешных не списывает снова', async () => {
    const { service, em } = makeService({ balance: 48, docChargedInTx: 2 });
    const doc = makeDoc({ balanceChargedAmount: 2 });
    await service.settle(doc);
    expect(em.update).not.toHaveBeenCalled();
    expect(em.insert).not.toHaveBeenCalled();
  });

  it('пересчёт с меньшим числом успешных позиций возвращает разницу', async () => {
    const { service, em } = makeService({ balance: 0, docChargedInTx: 3 });
    // Теперь все 3 позиции с ошибкой → 0 успешных, было списано 3 → возврат 3
    const doc = makeDoc({
      balanceChargedAmount: 3,
      resultData: [
        { calculationStatus: 'error' },
        { calculationStatus: 'error' },
        { calculationStatus: 'needs_info' },
      ],
    });
    await service.settle(doc);
    expect(em.update).toHaveBeenCalledWith(BillingAccount, { id: 'acc-1' }, { balance: 3 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: 3, type: 'adjustment', balanceAfter: 3 }),
    );
    expect(doc.balanceChargedAmount).toBe(0);
  });

  it('сбой транзакции не пробрасывается (best-effort)', async () => {
    const { service, accountRepo } = makeService();
    accountRepo.manager.transaction.mockRejectedValueOnce(new Error('db down') as never);
    const doc = makeDoc();
    await expect(service.settle(doc)).resolves.toBeUndefined();
    // balanceChargedAmount не обновлён, т.к. reconcile упал
    expect(doc.balanceChargedAmount).toBe(0);
  });
});

describe('ClientBalanceService.adjust', () => {
  it('ноль → 400', async () => {
    const { service } = makeService();
    await expect(service.adjust('acc-1', 0, { actorUserId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('дробное число → 400', async () => {
    const { service } = makeService();
    await expect(service.adjust('acc-1', 1.5, { actorUserId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('пополнение (amount>0) → balance += amount, запись type=topup', async () => {
    const { service, em } = makeService({ balance: 10 });
    const res = await service.adjust('acc-1', 50, { actorUserId: 'u1', comment: 'оплата' });
    expect(res.balance).toBe(60);
    expect(em.update).toHaveBeenCalledWith(BillingAccount, { id: 'acc-1' }, { balance: 60 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billingAccountId: 'acc-1',
        delta: 50,
        type: 'topup',
        balanceAfter: 60,
        createdByUserId: 'u1',
        comment: 'оплата',
      }),
    );
  });

  it('корректировка (amount<0) → type=adjustment', async () => {
    const { service, em } = makeService({ balance: 10 });
    const res = await service.adjust('acc-1', -4, { actorUserId: 'u1' });
    expect(res.balance).toBe(6);
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: -4, type: 'adjustment', balanceAfter: 6 }),
    );
  });
});

describe('ClientBalanceService.reconcileAbandonedReservations', () => {
  function setup(candidates: Document[], chargedInTx = 5) {
    const em = {
      findOne: jest.fn((entity: unknown) => {
        if (entity === BillingAccount) return Promise.resolve({ id: 'acc-1', balance: 0 });
        if (entity === Document)
          return Promise.resolve({ id: 'doc-f', balanceChargedAmount: chargedInTx });
        return Promise.resolve(null);
      }),
      update: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const docRepo = { find: jest.fn().mockResolvedValue(candidates) };
    const accountRepo = {
      findOne: jest.fn(),
      manager: {
        transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)),
        getRepository: jest.fn(() => docRepo),
      },
    };
    const tgUserRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'tg-1', billingAccountId: 'acc-1' }),
    };
    const service = new ClientBalanceService(
      accountRepo as never,
      { findAndCount: jest.fn() } as never,
      tgUserRepo as never,
    );
    return { service, em, docRepo };
  }

  it('возвращает удержанные позиции для брошенного FAILED (release до 0)', async () => {
    const { service, em } = setup([
      makeDoc({ id: 'doc-f', status: DocumentStatus.FAILED, balanceChargedAmount: 5 }),
    ]);
    const refunded = await service.reconcileAbandonedReservations();
    expect(refunded).toBe(1);
    // alreadyCharged=5, target=0 → возврат +5 на баланс, balanceChargedAmount → 0
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: 5, type: 'adjustment' }),
    );
    expect(em.update).toHaveBeenCalledWith(Document, { id: 'doc-f' }, { balanceChargedAmount: 0 });
  });

  it('нет кандидатов → 0, транзакция возврата не открывается', async () => {
    const { service, em } = setup([]);
    expect(await service.reconcileAbandonedReservations()).toBe(0);
    expect(em.insert).not.toHaveBeenCalled();
  });
});
