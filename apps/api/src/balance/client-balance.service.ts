import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { isIncompleteCalculationStatus } from '../common/product-notes';
import { BillingAccount } from '../database/entities/billing-account.entity';
import {
  DepositTransaction,
  DepositTransactionType,
} from '../database/entities/deposit-transaction.entity';
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
 * Владелец баланса и журнала — BillingAccount (пока 1:1 с TelegramUser); документ привязан
 * к клиенту, аккаунт резолвится по telegram_users.billing_account_id.
 */
@Injectable()
export class ClientBalanceService {
  private logger = new Logger(ClientBalanceService.name);

  constructor(
    @InjectRepository(BillingAccount) private accountRepo: Repository<BillingAccount>,
    @InjectRepository(DepositTransaction) private txRepo: Repository<DepositTransaction>,
    @InjectRepository(TelegramUser) private tgUserRepo: Repository<TelegramUser>,
  ) {}

  async getBalance(billingAccountId: string): Promise<number> {
    const row = await this.accountRepo.findOne({
      where: { id: billingAccountId },
      select: ['id', 'balance'],
    });
    return row?.balance ?? 0;
  }

  /** billing_account_id клиента (связь 1:1, неизменна после создания). */
  private async resolveAccountId(telegramUserId: string): Promise<string | null> {
    const row = await this.tgUserRepo.findOne({
      where: { id: telegramUserId },
      select: ['id', 'billingAccountId'],
    });
    return row?.billingAccountId ?? null;
  }

  /**
   * Проверка перед запуском обработки: хватает ли баланса на ещё не списанные позиции.
   * Документы без привязанного клиента (загрузки из админки) баланс не трогают.
   */
  async checkProcessingAllowed(doc: Document): Promise<ProcessingBalanceGate> {
    if (!doc.telegramUserId) return { allowed: true, need: 0, available: 0 };
    const positions = doc.rowCount || doc.parsedData?.length || 0;
    const need = Math.max(0, positions - (doc.balanceChargedAmount ?? 0));
    const accountId = await this.resolveAccountId(doc.telegramUserId);
    const available = accountId ? await this.getBalance(accountId) : 0;
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
    const accountId = await this.resolveAccountId(doc.telegramUserId);
    if (!accountId) return;
    const successfulCount = (doc.resultData ?? []).filter(
      (r) =>
        !isIncompleteCalculationStatus(
          (r as { calculationStatus?: unknown }).calculationStatus,
        ),
    ).length;
    try {
      await this.reconcileCharge(accountId, doc.id, doc.originalFileName, successfulCount);
      doc.balanceChargedAmount = successfulCount;
    } catch (err) {
      this.logger.error(
        `Failed to settle deposit for document ${doc.id} (account ${accountId}, ${successfulCount} positions)`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Атомарная сверка списанного с числом успешных позиций под локом на аккаунте. */
  private async reconcileCharge(
    billingAccountId: string,
    documentId: string,
    fileName: string,
    successfulCount: number,
  ): Promise<void> {
    await this.accountRepo.manager.transaction(async (em) => {
      const account = await em.findOne(BillingAccount, {
        where: { id: billingAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) return;
      // Свежее число уже списанного под локом: между save статуса и settle документ
      // мог быть пересчитан в другом потоке.
      const docRow = await em.findOne(Document, {
        where: { id: documentId },
        select: ['id', 'balanceChargedAmount'],
      });
      const alreadyCharged = docRow?.balanceChargedAmount ?? 0;
      const chargeDelta = successfulCount - alreadyCharged; // + дозалистываем, − возвращаем
      if (chargeDelta === 0) return;

      await this.writeDelta(em, account, -chargeDelta, {
        type: chargeDelta > 0 ? 'charge' : 'adjustment',
        documentId,
        createdByUserId: null,
        comment:
          chargeDelta > 0
            ? `Списание за обработку «${fileName}» (${successfulCount} поз.)`
            : `Возврат по пересчёту «${fileName}» (${alreadyCharged} → ${successfulCount} поз.)`,
      });
      await em.update(Document, { id: documentId }, { balanceChargedAmount: successfulCount });
    });
  }

  /**
   * Единственная точка изменения баланса: под уже взятым локом аккаунта сдвигает баланс
   * на delta и пишет ровно одну строку журнала с balanceAfter. Гарантирует инвариант
   * «любое движение баланса сопровождается записью в ledger». Вызывать внутри транзакции.
   */
  private async writeDelta(
    em: EntityManager,
    account: BillingAccount,
    delta: number,
    ledger: {
      type: DepositTransactionType;
      documentId: string | null;
      createdByUserId: string | null;
      comment: string | null;
    },
  ): Promise<number> {
    const newBalance = account.balance + delta;
    await em.update(BillingAccount, { id: account.id }, { balance: newBalance });
    await em.insert(DepositTransaction, {
      billingAccountId: account.id,
      delta,
      balanceAfter: newBalance,
      ...ledger,
    });
    return newBalance;
  }

  /**
   * Ручное изменение баланса менеджером: пополнение (amount > 0) после оплаты вне
   * системы или корректировка (amount < 0). Атомарно под локом + запись в журнал.
   */
  async adjust(
    billingAccountId: string,
    amount: number,
    opts: { actorUserId: string; comment?: string },
  ): Promise<{ balance: number }> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_DEPOSIT_AMOUNT,
        message: 'Deposit amount must be a non-zero integer',
      });
    }
    return this.accountRepo.manager.transaction(async (em) => {
      const account = await em.findOne(BillingAccount, {
        where: { id: billingAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Billing account not found');
      }
      const newBalance = await this.writeDelta(em, account, amount, {
        type: amount > 0 ? 'topup' : 'adjustment',
        documentId: null,
        createdByUserId: opts.actorUserId,
        comment: opts.comment?.trim() || null,
      });
      return { balance: newBalance };
    });
  }

  async listTransactions(
    billingAccountId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResponse<DepositTransactionView>> {
    const [data, total] = await this.txRepo.findAndCount({
      where: { billingAccountId },
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
