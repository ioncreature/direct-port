import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { isIncompleteCalculationStatus } from '../common/product-notes';
import { DepositTransaction } from '../database/entities/deposit-transaction.entity';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';

export interface ProcessingBalanceGate {
  allowed: boolean;
  /** Сколько позиций ещё нужно списать за документ (с учётом уже списанного). */
  need: number;
  /** Текущий баланс клиента в позициях. */
  available: number;
}

/** Запись истории операций для отображения в админке (без чувствительных полей User). */
export interface DepositTransactionView {
  id: string;
  delta: number;
  type: DepositTransaction['type'];
  balanceAfter: number;
  documentId: string | null;
  comment: string | null;
  createdByEmail: string | null;
  createdAt: Date;
}

/**
 * Депозит клиента в «обработанных позициях»: проверка перед запуском обработки,
 * идемпотентное списание после успешной обработки, ручные пополнения/корректировки.
 * Денормализованный баланс — в TelegramUser.balance, журнал — в deposit_transactions.
 */
@Injectable()
export class ClientBalanceService {
  private logger = new Logger(ClientBalanceService.name);

  constructor(
    @InjectRepository(TelegramUser) private tgUserRepo: Repository<TelegramUser>,
    @InjectRepository(DepositTransaction) private txRepo: Repository<DepositTransaction>,
  ) {}

  async getBalance(telegramUserId: string): Promise<number> {
    const row = await this.tgUserRepo.findOne({
      where: { id: telegramUserId },
      select: ['id', 'balance'],
    });
    return row?.balance ?? 0;
  }

  /**
   * Проверка перед запуском обработки: хватает ли баланса на ещё не списанные позиции.
   * Документы без привязанного клиента (загрузки из админки) баланс не трогают.
   */
  async checkProcessingAllowed(doc: Document): Promise<ProcessingBalanceGate> {
    if (!doc.telegramUserId) return { allowed: true, need: 0, available: 0 };
    const positions = doc.rowCount || doc.parsedData?.length || 0;
    const need = Math.max(0, positions - (doc.balanceChargedAmount ?? 0));
    const available = await this.getBalance(doc.telegramUserId);
    return { allowed: need === 0 || available >= need, need, available };
  }

  /**
   * Списание за успешно обработанный документ. Идемпотентно: сверяет число успешно
   * посчитанных позиций с уже списанным (doc.balanceChargedAmount) и доводит разницу —
   * повторный вызов (reprocess/recalculate/ручная правка кода) не задваивает списание,
   * а пересчёт с меньшим числом успешных позиций возвращает разницу на баланс.
   *
   * Списывает только для документов с привязанным клиентом и только в «оплачиваемом»
   * статусе (PROCESSED / PROCESSED_WITH_ERRORS). Никогда не бросает: сбой логируется,
   * но не роняет уже сохранённый статус документа.
   */
  async settle(doc: Document): Promise<void> {
    if (!doc.telegramUserId) return;
    if (
      doc.status !== DocumentStatus.PROCESSED &&
      doc.status !== DocumentStatus.PROCESSED_WITH_ERRORS
    ) {
      return;
    }
    const successfulCount = (doc.resultData ?? []).filter(
      (r) =>
        !isIncompleteCalculationStatus(
          (r as { calculationStatus?: unknown }).calculationStatus,
        ),
    ).length;
    try {
      await this.reconcileCharge(
        doc.telegramUserId,
        doc.id,
        doc.originalFileName,
        successfulCount,
      );
      doc.balanceChargedAmount = successfulCount;
    } catch (err) {
      this.logger.error(
        `Failed to settle deposit for document ${doc.id} (client ${doc.telegramUserId}, ${successfulCount} positions)`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Атомарная сверка списанного с числом успешных позиций под локом на клиенте. */
  private async reconcileCharge(
    telegramUserId: string,
    documentId: string,
    fileName: string,
    successfulCount: number,
  ): Promise<void> {
    await this.tgUserRepo.manager.transaction(async (em) => {
      const tgUser = await em.findOne(TelegramUser, {
        where: { id: telegramUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tgUser) return;
      // Свежее число уже списанного под локом: между save статуса и settle документ
      // мог быть пересчитан в другом потоке.
      const docRow = await em.findOne(Document, {
        where: { id: documentId },
        select: ['id', 'balanceChargedAmount'],
      });
      const alreadyCharged = docRow?.balanceChargedAmount ?? 0;
      const chargeDelta = successfulCount - alreadyCharged; // + дозалистываем, − возвращаем
      if (chargeDelta === 0) return;

      const balanceDelta = -chargeDelta; // списание уменьшает баланс
      const newBalance = tgUser.balance + balanceDelta;
      await em.update(TelegramUser, { id: telegramUserId }, { balance: newBalance });
      await em.update(Document, { id: documentId }, { balanceChargedAmount: successfulCount });
      await em.insert(DepositTransaction, {
        telegramUserId,
        delta: balanceDelta,
        type: chargeDelta > 0 ? 'charge' : 'adjustment',
        balanceAfter: newBalance,
        documentId,
        createdByUserId: null,
        comment:
          chargeDelta > 0
            ? `Списание за обработку «${fileName}» (${successfulCount} поз.)`
            : `Возврат по пересчёту «${fileName}» (${alreadyCharged} → ${successfulCount} поз.)`,
      });
    });
  }

  /**
   * Ручное изменение баланса менеджером: пополнение (amount > 0) после оплаты вне
   * системы или корректировка (amount < 0). Атомарно под локом + запись в журнал.
   */
  async adjust(
    telegramUserId: string,
    amount: number,
    opts: { actorUserId: string; comment?: string },
  ): Promise<{ balance: number }> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_DEPOSIT_AMOUNT,
        message: 'Deposit amount must be a non-zero integer',
      });
    }
    return this.tgUserRepo.manager.transaction(async (em) => {
      const tgUser = await em.findOne(TelegramUser, {
        where: { id: telegramUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tgUser) {
        throw new NotFoundException('Telegram user not found');
      }
      const newBalance = tgUser.balance + amount;
      await em.update(TelegramUser, { id: telegramUserId }, { balance: newBalance });
      await em.insert(DepositTransaction, {
        telegramUserId,
        delta: amount,
        type: amount > 0 ? 'topup' : 'adjustment',
        balanceAfter: newBalance,
        documentId: null,
        createdByUserId: opts.actorUserId,
        comment: opts.comment?.trim() || null,
      });
      return { balance: newBalance };
    });
  }

  async listTransactions(
    telegramUserId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResponse<DepositTransactionView>> {
    const [data, total] = await this.txRepo.findAndCount({
      where: { telegramUserId },
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const view = data.map<DepositTransactionView>((t) => ({
      id: t.id,
      delta: t.delta,
      type: t.type,
      balanceAfter: t.balanceAfter,
      documentId: t.documentId,
      comment: t.comment,
      createdByEmail: t.createdBy?.email ?? null,
      createdAt: t.createdAt,
    }));
    return paginate(view, total, query.page, query.limit);
  }
}
