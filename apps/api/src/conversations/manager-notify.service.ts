import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Not, Repository } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { User } from '../database/entities/user.entity';
import {
  formatClientName,
  mapDocStatusToManagerEvent,
  type ConversationClient,
  type ManagerEventType,
  type ManagerNotification,
} from './manager-notification';
import { DELIVERY_JOB_OPTS } from './queue-opts';

/**
 * Ставит события в очередь manager-notifications (потребляет manager-bot).
 * Резолвит адресатов: назначенный менеджер клиента, иначе broadcast всем привязанным.
 * Вынесен в отдельный лёгкий модуль, чтобы DocumentsModule мог его импортировать
 * без обратной зависимости на ConversationsModule (цикла нет).
 */
@Injectable()
export class ManagerNotifyService {
  private logger = new Logger(ManagerNotifyService.name);

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectQueue('manager-notifications') private queue: Queue,
  ) {}

  /** Клиент прислал новый файл — менеджер решит, когда запускать расчёт. */
  async notifyNewDocument(doc: Document, text?: string): Promise<void> {
    if (!doc.telegramUser) return;
    await this.enqueue('new_document', doc.telegramUser, {
      documentId: doc.id,
      documentName: doc.originalFileName,
      text,
    });
  }

  /** Клиент написал сообщение/прислал вложение. */
  async notifyClientMessage(
    client: ConversationClient,
    opts: { text?: string; attachmentType?: string },
  ): Promise<void> {
    await this.enqueue('client_message', client, {
      text: opts.text,
      attachmentType: opts.attachmentType,
    });
  }

  /** Клиент оформил заявку на пополнение — менеджер подтверждает оплату кнопкой. */
  async notifyTopUpRequest(
    request: { id: string; positions: number; amount: number; currency: string },
    client: ConversationClient,
  ): Promise<void> {
    await this.enqueue('topup_request', client, {
      topUpId: request.id,
      positions: request.positions,
      amount: request.amount,
      currency: request.currency,
    });
  }

  /**
   * Финальное событие пайплайна. Маппит doc.status в менеджерское событие;
   * промежуточные статусы игнорируются (вернёт без отправки).
   */
  async notifyDocumentEvent(doc: Document): Promise<void> {
    const event = mapDocStatusToManagerEvent(doc.status);
    if (!event || !doc.telegramUser) return;
    await this.enqueue(event, doc.telegramUser, {
      documentId: doc.id,
      documentName: doc.originalFileName,
      statusLabel: doc.statusLabel,
      resultReady: doc.status === DocumentStatus.PROCESSED,
      // Причину показываем только для ошибки (нехватка баланса, недоступность курсов и т.п.).
      reason: doc.status === DocumentStatus.FAILED ? (doc.errorMessage ?? undefined) : undefined,
    });
  }

  /**
   * Текстовый отчёт автономного лидген-агента. Не про клиента — broadcast привязанным
   * менеджерам компании. Лидген-агент пока один на платформу (дефолтная компания), поэтому
   * companyId по умолчанию DEFAULT_COMPANY_ID; при втором провайдере контур параметризуется.
   */
  async notifyLeadsReport(
    text: string,
    companyId: string = DEFAULT_COMPANY_ID,
  ): Promise<{ delivered: boolean }> {
    const managerTelegramIds = await this.resolveManagers(null, companyId);
    if (managerTelegramIds.length === 0) {
      this.logger.warn('No linked managers to notify (leads_report)');
      return { delivered: false };
    }
    const payload: ManagerNotification = {
      event: 'leads_report',
      companyId,
      managerTelegramIds,
      text,
    };
    await this.queue.add('manager-notify', payload, DELIVERY_JOB_OPTS);
    return { delivered: true };
  }

  private async enqueue(
    event: ManagerEventType,
    client: ConversationClient,
    extra: Partial<ManagerNotification>,
  ): Promise<void> {
    const managerTelegramIds = await this.resolveManagers(
      client.assignedManagerId,
      client.companyId,
    );
    if (managerTelegramIds.length === 0) {
      this.logger.warn(
        `No linked managers to notify (event=${event}, client=${client.id})`,
      );
      return;
    }
    const payload: ManagerNotification = {
      event,
      companyId: client.companyId,
      managerTelegramIds,
      clientId: client.id,
      clientName: formatClientName(client),
      clientTelegramId: client.telegramId,
      assigned: Boolean(client.assignedManagerId),
      ...extra,
    };
    // Сбой постановки НЕ глотается: intake ответит 500, и client-bot честно скажет
    // клиенту об ошибке (вместо «принято» при потерянном уведомлении). Вызовы из
    // pipeline-воркеров изолированы на их стороне (notify — best-effort).
    await this.queue.add('manager-notify', payload, DELIVERY_JOB_OPTS);
  }

  /**
   * Адресаты в рамках компании: назначенный менеджер, иначе все активные привязанные менеджеры
   * этой компании (broadcast). Фильтр по companyId — тенант-изоляция: уведомления клиента видят
   * только менеджеры его компании (а не вся платформа, как было до ботов per-company).
   */
  private async resolveManagers(
    assignedManagerId: string | null,
    companyId: string,
  ): Promise<string[]> {
    if (assignedManagerId) {
      const manager = await this.usersRepo.findOne({
        where: { id: assignedManagerId, isActive: true, companyId },
        select: ['managerTelegramId'],
      });
      if (manager?.managerTelegramId) return [manager.managerTelegramId];
      // Назначенный менеджер отвязан/деактивирован/из другой компании: не теряем событие,
      // отдаём его в broadcast остальным менеджерам компании (раньше тут возвращался [] и
      // уведомление дропалось).
      this.logger.warn(
        `Assigned manager ${assignedManagerId} is unlinked, inactive or cross-company — falling back to broadcast`,
      );
    }
    const managers = await this.usersRepo.find({
      where: { managerTelegramId: Not(IsNull()), isActive: true, companyId },
      select: ['managerTelegramId'],
    });
    return managers
      .map((m) => m.managerTelegramId)
      .filter((id): id is string => Boolean(id));
  }
}
