import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import {
  INCOMPLETE_CALCULATION_STATUSES,
  isIncompleteCalculationStatus,
} from '../common/product-notes';
import { BillingAccount } from '../database/entities/billing-account.entity';
import {
  DepositTransaction,
  DepositTransactionType,
} from '../database/entities/deposit-transaction.entity';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { TopUpRequest } from '../database/entities/top-up-request.entity';

export interface ProcessingBalanceGate {
  allowed: boolean;
  /** Сколько позиций ещё нужно списать за документ (с учётом уже списанного). */
  need: number;
  /** Текущий баланс клиента в позициях. */
  available: number;
  /** Сколько было списано за документ ДО этого прогона — цель releaseReservation при сбое. */
  previousCharged: number;
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
   * Атомарный гейт+резерв перед запуском обработки: под локом аккаунта сверяет баланс
   * с ещё не списанными позициями и сразу удерживает их (charge). Раньше гейт был
   * незалоченным чтением, оторванным от списания в конце пайплайна, — два документа
   * одного клиента, запущенные параллельно, оба проходили по полному балансу, и два
   * settle уводили баланс в минус (клиент получал больше позиций, чем оплатил).
   *
   * По завершении прогона settle доводит удержанное до фактического числа успешных
   * позиций (разница возвращается); при сбое прогона releaseReservation откатывает
   * к previousCharged. Документы без привязанного клиента (загрузки из админки)
   * баланс не трогают.
   */
  async reserveProcessing(doc: Document): Promise<ProcessingBalanceGate> {
    const noop: ProcessingBalanceGate = {
      allowed: true,
      need: 0,
      available: 0,
      previousCharged: doc.balanceChargedAmount ?? 0,
    };
    if (!doc.telegramUserId) return noop;
    const positions = doc.rowCount || doc.parsedData?.length || 0;
    const accountId = await this.resolveAccountId(doc.telegramUserId);
    if (!accountId) return noop;

    return this.accountRepo.manager.transaction(async (em) => {
      const account = await em.findOne(BillingAccount, {
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) return noop;
      // Свежее число уже списанного под локом — reprocess/recalculate не должны
      // резервировать повторно то, что уже удержано прошлым прогоном.
      const docRow = await em.findOne(Document, {
        where: { id: doc.id },
        select: ['id', 'balanceChargedAmount'],
      });
      const previousCharged = docRow?.balanceChargedAmount ?? 0;
      const need = Math.max(0, positions - previousCharged);
      if (need === 0) {
        return { allowed: true, need: 0, available: account.balance, previousCharged };
      }
      if (account.balance < need) {
        return { allowed: false, need, available: account.balance, previousCharged };
      }
      await this.writeDelta(em, account, -need, {
        type: 'charge',
        documentId: doc.id,
        createdByUserId: null,
        comment: `Списание за обработку «${doc.originalFileName}» (${positions} поз.)`,
      });
      await em.update(Document, { id: doc.id }, { balanceChargedAmount: positions });
      doc.balanceChargedAmount = positions;
      return { allowed: true, need, available: account.balance - need, previousCharged };
    });
  }

  /**
   * Откат резерва при неуспешном завершении прогона: доводит списанное до
   * targetCharged (обычно previousCharged из reserveProcessing — состояние до
   * прогона; 0 при reject — отклонённый документ не оплачивается). Никогда не
   * бросает — как settle, откат best-effort: расхождение доберёт следующий
   * reprocess (reserveProcessing сверяет удержанное под локом).
   */
  async releaseReservation(doc: Document, targetCharged: number): Promise<void> {
    if (!doc.telegramUserId) return;
    try {
      const accountId = await this.resolveAccountId(doc.telegramUserId);
      if (!accountId) return;
      await this.reconcileCharge(accountId, doc.id, doc.originalFileName, targetCharged, 'release');
      doc.balanceChargedAmount = targetCharged;
    } catch (err) {
      this.logger.error(
        `Failed to release reservation for document ${doc.id} (target ${targetCharged})`,
        err instanceof Error ? err.stack : err,
      );
    }
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

  /** Атомарная сверка списанного с целевым числом позиций под локом на аккаунте.
   *  reason управляет только текстом ledger-комментария: 'settle' — доведение до
   *  успешных позиций, 'release' — откат резерва после неуспешного прогона. */
  private async reconcileCharge(
    billingAccountId: string,
    documentId: string,
    fileName: string,
    successfulCount: number,
    reason: 'settle' | 'release' = 'settle',
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
            : reason === 'release'
              ? `Возврат резерва «${fileName}» (${alreadyCharged} → ${successfulCount} поз.)`
              : `Возврат по пересчёту «${fileName}» (${alreadyCharged} → ${successfulCount} поз.)`,
      });
      await em.update(Document, { id: documentId }, { balanceChargedAmount: successfulCount });
    });
  }

  /**
   * Фоновая сверка списаний: находит оплачиваемые документы клиентов, у которых
   * списано не столько, сколько успешных позиций, и доводит разницу повторным settle.
   * Закрывает «тихие» расхождения best-effort-операций (settle/releaseReservation
   * никогда не бросают — транзиентный сбой БД на них раньше означал бесплатную
   * обработку или невозвращённый резерв навсегда).
   *
   * SQL — только префильтр кандидатов (список неполных статусов разделён с TS через
   * INCOMPLETE_CALCULATION_STATUSES); истину устанавливает settle, который считает
   * успешные позиции той же TS-логикой и сверяет под локом. Окно по updated_at
   * ограничивает скан свежими документами. Конкурентные вызовы с нескольких реплик
   * безопасны: reconcileCharge идемпотентен по абсолютному целевому значению.
   */
  async reconcileSettledDocuments(windowDays = 7): Promise<number> {
    const docRepo = this.accountRepo.manager.getRepository(Document);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    const candidates: Array<{ id: string }> = await docRepo.query(
      `SELECT d.id
       FROM documents d
       WHERE d.status IN ($1, $2)
         AND d.telegram_user_id IS NOT NULL
         AND d.updated_at > $3
         AND d.balance_charged_amount <> (
           SELECT COUNT(*)
           FROM jsonb_array_elements(COALESCE(d.result_data, '[]'::jsonb)) r
           WHERE NOT (r->>'calculationStatus' = ANY($4))
         )`,
      [
        DocumentStatus.PROCESSED,
        DocumentStatus.PROCESSED_WITH_ERRORS,
        cutoff,
        [...INCOMPLETE_CALCULATION_STATUSES],
      ],
    );
    let fixed = 0;
    for (const { id } of candidates) {
      const doc = await docRepo.findOne({ where: { id } });
      if (!doc) continue;
      const before = doc.balanceChargedAmount;
      await this.settle(doc);
      if (doc.balanceChargedAmount !== before) {
        fixed += 1;
        this.logger.warn(
          `Reconciled deposit charge for document ${id}: ${before} → ${doc.balanceChargedAmount} positions`,
        );
      }
    }
    return fixed;
  }

  /**
   * Возврат «осиротевших» резервов: терминальный FAILED/REJECTED документ, за которым
   * остались удержаны позиции (balance_charged_amount > 0). Штатно резерв откатывает
   * releaseReservation в catch-ветке процессора, но если под убит посреди прогона
   * (SIGKILL при деплое) или транзиентный сбой БД съел откат, документ уходит в FAILED
   * (через StuckDocumentsWatchdog, который баланс не трогает) с удержанными позициями —
   * тихая потеря кредитов клиента без следа, кроме error-лога. FAILED/REJECTED не дают
   * клиенту скачиваемого результата (download только для PROCESSED), поэтому целевое
   * списание — 0, как в reject и финальном catch процессора. Идемпотентно: releaseReservation
   * сверяет удержанное под локом, повторный проход/несколько реплик безопасны.
   */
  async reconcileAbandonedReservations(windowDays = 7): Promise<number> {
    const docRepo = this.accountRepo.manager.getRepository(Document);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    // Фильтр целиком выразим query-builder'ом (в отличие от reconcileSettledDocuments, которому
    // нужен raw SQL ради jsonb-COUNT). select — только поля, нужные releaseReservation: тяжёлые
    // jsonb (parsedData/resultData) в фоновый свип не тянем.
    const candidates = await docRepo.find({
      where: {
        status: In([DocumentStatus.FAILED, DocumentStatus.REJECTED]),
        telegramUserId: Not(IsNull()),
        balanceChargedAmount: MoreThan(0),
        updatedAt: MoreThan(cutoff),
      },
      select: ['id', 'status', 'telegramUserId', 'originalFileName', 'balanceChargedAmount'],
    });
    let refunded = 0;
    for (const doc of candidates) {
      const before = doc.balanceChargedAmount;
      await this.releaseReservation(doc, 0);
      if (doc.balanceChargedAmount !== before) {
        refunded += 1;
        this.logger.warn(
          `Refunded abandoned reservation for ${doc.status} document ${doc.id}: ${before} → 0 positions`,
        );
      }
    }
    return refunded;
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
      sourceRequestId?: string | null;
    },
  ): Promise<number> {
    const newBalance = account.balance + delta;
    await em.update(BillingAccount, { id: account.id }, { balance: newBalance });
    await em.insert(DepositTransaction, {
      billingAccountId: account.id,
      delta,
      balanceAfter: newBalance,
      ...ledger,
      sourceRequestId: ledger.sourceRequestId ?? null,
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

  /**
   * Приветственный бонус нового клиента (онбординг: «первые N позиций бесплатно» с
   * лендинга). Идемпотентно: под локом аккаунта проверяется, что grant-транзакций у
   * аккаунта ещё нет — повторный вызов (retry регистрации, гонка) бонус не задваивает.
   * type='grant' сознательно не входит в «пополнения» дашборда (не выручка).
   */
  async grantWelcome(billingAccountId: string, positions: number): Promise<{ granted: boolean }> {
    if (!Number.isInteger(positions) || positions <= 0) return { granted: false };
    return this.accountRepo.manager.transaction(async (em) => {
      const account = await em.findOne(BillingAccount, {
        where: { id: billingAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Billing account not found');
      }
      const existing = await em.findOne(DepositTransaction, {
        where: { billingAccountId, type: 'grant' },
        select: ['id'],
      });
      if (existing) return { granted: false };
      await this.writeDelta(em, account, positions, {
        type: 'grant',
        documentId: null,
        createdByUserId: null,
        comment: `Приветственный бонус (${positions} бесплатных позиций)`,
      });
      return { granted: true };
    });
  }

  /**
   * Зачисление кредитов по подтверждённой заявке на пополнение. Идемпотентно: статус
   * заявки перечитывается ПОД локом аккаунта, поэтому конкурентное/повторное
   * подтверждение (два менеджера, двойной клик) второй раз вернёт already-confirmed без
   * задвоения. Уникальный индекс deposit_transactions(source_request_id) — финальный
   * страховочный барьер. Меняет баланс только здесь — единый writer сохраняется.
   */
  async confirmTopUp(requestId: string, confirmedByUserId: string): Promise<TopUpRequest> {
    return this.accountRepo.manager.transaction(async (em) => {
      const head = await em.findOne(TopUpRequest, {
        where: { id: requestId },
        select: ['id', 'billingAccountId'],
      });
      if (!head) {
        throw new NotFoundException({ code: ErrorCode.TOPUP_NOT_FOUND, message: 'Top-up request not found' });
      }
      // Лок на аккаунте сериализует конкурентные подтверждения этой же заявки.
      const account = await em.findOne(BillingAccount, {
        where: { id: head.billingAccountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException({ code: ErrorCode.TOPUP_NOT_FOUND, message: 'Billing account not found' });
      }
      // Свежий статус под локом: первый подтвердивший уже мог перевести в confirmed.
      const request = await em.findOneOrFail(TopUpRequest, { where: { id: requestId } });
      if (request.status === 'confirmed') return request;
      if (request.status === 'canceled') {
        throw new BadRequestException({
          code: ErrorCode.TOPUP_NOT_PENDING,
          message: 'Top-up request is canceled',
        });
      }
      await this.writeDelta(em, account, request.positions, {
        type: 'topup',
        documentId: null,
        createdByUserId: confirmedByUserId,
        comment: `Пополнение по заявке (${request.positions} поз., ${request.amount} ${request.currency})`,
        sourceRequestId: request.id,
      });
      const confirmedAt = new Date();
      await em.update(
        TopUpRequest,
        { id: request.id },
        { status: 'confirmed', confirmedByUserId, confirmedAt },
      );
      return { ...request, status: 'confirmed', confirmedByUserId, confirmedAt };
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
