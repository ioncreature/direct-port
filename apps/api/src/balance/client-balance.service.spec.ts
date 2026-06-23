import { BadRequestException } from '@nestjs/common';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
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
  opts: { balance?: number; docChargedInTx?: number; tgUserExists?: boolean } = {},
) {
  const balance = opts.balance ?? 0;
  const em = {
    findOne: jest.fn((entity: unknown) => {
      if (entity === TelegramUser) {
        return Promise.resolve(opts.tgUserExists === false ? null : { id: 'tg-1', balance });
      }
      if (entity === Document) {
        return Promise.resolve({ id: 'doc-1', balanceChargedAmount: opts.docChargedInTx ?? 0 });
      }
      return Promise.resolve(null);
    }),
    update: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const tgUserRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'tg-1', balance }),
    manager: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)) },
  };
  const txRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
  const service = new ClientBalanceService(tgUserRepo as never, txRepo as never);
  return { service, em, tgUserRepo, txRepo };
}

describe('ClientBalanceService.getBalance', () => {
  it('возвращает баланс клиента', async () => {
    const { service } = makeService({ balance: 7 });
    expect(await service.getBalance('tg-1')).toBe(7);
  });

  it('нет записи → 0', async () => {
    const { service, tgUserRepo } = makeService();
    tgUserRepo.findOne.mockResolvedValueOnce(null);
    expect(await service.getBalance('tg-1')).toBe(0);
  });
});

describe('ClientBalanceService.checkProcessingAllowed', () => {
  it('документ без клиента → разрешено, баланс не запрашивается', async () => {
    const { service, tgUserRepo } = makeService();
    const gate = await service.checkProcessingAllowed(makeDoc({ telegramUserId: null }));
    expect(gate.allowed).toBe(true);
    expect(gate.need).toBe(0);
    expect(tgUserRepo.findOne).not.toHaveBeenCalled();
  });

  it('баланса хватает → allowed=true, need=rowCount', async () => {
    const { service } = makeService({ balance: 20 });
    const gate = await service.checkProcessingAllowed(makeDoc({ rowCount: 20 }));
    expect(gate).toEqual({ allowed: true, need: 20, available: 20 });
  });

  it('баланса не хватает → allowed=false', async () => {
    const { service } = makeService({ balance: 5 });
    const gate = await service.checkProcessingAllowed(makeDoc({ rowCount: 20 }));
    expect(gate).toEqual({ allowed: false, need: 20, available: 5 });
  });

  it('учитывает уже списанное: need = rowCount − balanceChargedAmount', async () => {
    const { service } = makeService({ balance: 1 });
    const gate = await service.checkProcessingAllowed(
      makeDoc({ rowCount: 20, balanceChargedAmount: 18 }),
    );
    expect(gate).toEqual({ allowed: false, need: 2, available: 1 });
  });

  it('всё уже списано (need=0) → allowed даже при нулевом балансе', async () => {
    const { service } = makeService({ balance: 0 });
    const gate = await service.checkProcessingAllowed(
      makeDoc({ rowCount: 20, balanceChargedAmount: 20 }),
    );
    expect(gate).toEqual({ allowed: true, need: 0, available: 0 });
  });
});

describe('ClientBalanceService.settle', () => {
  it('документ без клиента → транзакция не открывается', async () => {
    const { service, tgUserRepo } = makeService();
    const doc = makeDoc({ telegramUserId: null });
    await service.settle(doc);
    expect(tgUserRepo.manager.transaction).not.toHaveBeenCalled();
    expect(doc.balanceChargedAmount).toBe(0);
  });

  it('неоплачиваемый статус (PENDING) → списания нет', async () => {
    const { service, tgUserRepo } = makeService();
    await service.settle(makeDoc({ status: DocumentStatus.PENDING }));
    expect(tgUserRepo.manager.transaction).not.toHaveBeenCalled();
  });

  it('списывает только успешные позиции (exact/partial), не needs_info/error', async () => {
    const { service, em } = makeService({ balance: 50, docChargedInTx: 0 });
    const doc = makeDoc(); // 2 успешных (exact, partial) + 1 needs_info
    await service.settle(doc);

    // Баланс уменьшается на 2
    expect(em.update).toHaveBeenCalledWith(TelegramUser, { id: 'tg-1' }, { balance: 48 });
    expect(em.update).toHaveBeenCalledWith(Document, { id: 'doc-1' }, { balanceChargedAmount: 2 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: -2, type: 'charge', balanceAfter: 48, documentId: 'doc-1' }),
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
    expect(em.update).toHaveBeenCalledWith(TelegramUser, { id: 'tg-1' }, { balance: 3 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: 3, type: 'adjustment', balanceAfter: 3 }),
    );
    expect(doc.balanceChargedAmount).toBe(0);
  });

  it('сбой транзакции не пробрасывается (best-effort)', async () => {
    const { service, tgUserRepo } = makeService();
    tgUserRepo.manager.transaction.mockRejectedValueOnce(new Error('db down') as never);
    const doc = makeDoc();
    await expect(service.settle(doc)).resolves.toBeUndefined();
    // balanceChargedAmount не обновлён, т.к. reconcile упал
    expect(doc.balanceChargedAmount).toBe(0);
  });
});

describe('ClientBalanceService.adjust', () => {
  it('ноль → 400', async () => {
    const { service } = makeService();
    await expect(service.adjust('tg-1', 0, { actorUserId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('дробное число → 400', async () => {
    const { service } = makeService();
    await expect(service.adjust('tg-1', 1.5, { actorUserId: 'u1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('пополнение (amount>0) → balance += amount, запись type=topup', async () => {
    const { service, em } = makeService({ balance: 10 });
    const res = await service.adjust('tg-1', 50, { actorUserId: 'u1', comment: 'оплата' });
    expect(res.balance).toBe(60);
    expect(em.update).toHaveBeenCalledWith(TelegramUser, { id: 'tg-1' }, { balance: 60 });
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
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
    const res = await service.adjust('tg-1', -4, { actorUserId: 'u1' });
    expect(res.balance).toBe(6);
    expect(em.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: -4, type: 'adjustment', balanceAfter: 6 }),
    );
  });
});
