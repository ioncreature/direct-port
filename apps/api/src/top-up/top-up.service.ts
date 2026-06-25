import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientBalanceService } from '../balance/client-balance.service';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { TopUpRequest, TopUpStatus } from '../database/entities/top-up-request.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { findPurchasablePackage, purchasablePackages, TopUpPackage } from './packages';

/** Заявка на пополнение для отображения в кабинете (без внутренних полей менеджера). */
export interface TopUpRequestView {
  id: string;
  packageKey: string | null;
  positions: number;
  amount: number;
  currency: string;
  pricePerPosition: number;
  status: TopUpStatus;
  comment: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

/**
 * Денежный слой кабинета: заявки на пополнение. Клиент создаёт заявку (pending),
 * менеджер подтверждает оплату → ClientBalanceService зачисляет кредиты идемпотентно.
 * Сам баланс этот сервис не меняет — только статусы заявок и уведомления.
 */
@Injectable()
export class TopUpService {
  private logger = new Logger(TopUpService.name);

  constructor(
    @InjectRepository(TopUpRequest) private repo: Repository<TopUpRequest>,
    @InjectRepository(TelegramUser) private tgRepo: Repository<TelegramUser>,
    private balance: ClientBalanceService,
    private managerNotify: ManagerNotifyService,
    private conversations: ConversationsService,
  ) {}

  getPackages(): TopUpPackage[] {
    return purchasablePackages();
  }

  /**
   * Создать заявку на пополнение по пакету. Деньги фиксируются из пакета на момент
   * заявки (клиент не может подменить цену). Уведомление менеджеру — best-effort:
   * заявка уже сохранена и видна клиенту, потеря пинга при недоступном Redis её не теряет.
   */
  async createRequest(
    accountId: string,
    telegramUserId: string,
    packageKey: string,
  ): Promise<TopUpRequestView> {
    const pkg = findPurchasablePackage(packageKey);
    if (!pkg) {
      throw new BadRequestException({ code: ErrorCode.INVALID_PACKAGE, message: 'Unknown package' });
    }
    const client = await this.tgRepo.findOne({ where: { id: telegramUserId } });
    if (!client || client.billingAccountId !== accountId) {
      throw new ForbiddenException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'Telegram user does not belong to this account',
      });
    }
    const request = await this.repo.save(
      this.repo.create({
        billingAccountId: accountId,
        createdByTelegramUserId: telegramUserId,
        packageKey: pkg.key,
        positions: pkg.positions,
        amount: pkg.amount,
        currency: pkg.currency,
        pricePerPosition: pkg.perPosition,
        status: 'pending',
      }),
    );
    await this.managerNotify
      .notifyTopUpRequest(request, client)
      .catch((err) =>
        this.logger.warn(`Failed to notify managers about top-up ${request.id}`, err),
      );
    return this.toView(request);
  }

  async listRequests(
    accountId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResponse<TopUpRequestView>> {
    const [data, total] = await this.repo.findAndCount({
      where: { billingAccountId: accountId },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginate(data.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  /** Клиент отменяет свою ещё не подтверждённую заявку. */
  async cancelOwnRequest(accountId: string, requestId: string): Promise<TopUpRequestView> {
    const request = await this.findRequest(requestId, accountId);
    return this.toView(await this.cancel(request));
  }

  /** Менеджер подтверждает оплату → зачисление кредитов (идемпотентно). */
  async confirmByManager(requestId: string, managerTelegramId: string): Promise<TopUpRequestView> {
    const manager = await this.conversations.resolveManagerOrThrow(managerTelegramId);
    const request = await this.balance.confirmTopUp(requestId, manager.id);
    return this.toView(request);
  }

  /** Менеджер отклоняет неоплаченную заявку. Подтверждённую отклонить нельзя. */
  async cancelByManager(requestId: string, managerTelegramId: string): Promise<TopUpRequestView> {
    await this.conversations.resolveManagerOrThrow(managerTelegramId);
    const request = await this.findRequest(requestId);
    return this.toView(await this.cancel(request));
  }

  private async cancel(request: TopUpRequest): Promise<TopUpRequest> {
    if (request.status === 'canceled') return request; // идемпотентно
    if (request.status === 'confirmed') {
      throw new BadRequestException({
        code: ErrorCode.TOPUP_ALREADY_CONFIRMED,
        message: 'Confirmed top-up cannot be canceled',
      });
    }
    await this.repo.update({ id: request.id }, { status: 'canceled' });
    return { ...request, status: 'canceled' };
  }

  /** Заявка по id; при заданном accountId — только своя (иначе 404, без утечки чужой). */
  private async findRequest(requestId: string, accountId?: string): Promise<TopUpRequest> {
    const request = await this.repo.findOne({ where: { id: requestId } });
    if (!request || (accountId && request.billingAccountId !== accountId)) {
      throw new NotFoundException({ code: ErrorCode.TOPUP_NOT_FOUND, message: 'Top-up request not found' });
    }
    return request;
  }

  private toView(r: TopUpRequest): TopUpRequestView {
    return {
      id: r.id,
      packageKey: r.packageKey,
      positions: r.positions,
      amount: r.amount,
      currency: r.currency,
      pricePerPosition: r.pricePerPosition,
      status: r.status,
      comment: r.comment,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
    };
  }
}
