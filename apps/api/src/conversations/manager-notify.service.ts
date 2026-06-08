import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Not, Repository } from 'typeorm';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { User } from '../database/entities/user.entity';
import {
  formatClientName,
  mapDocStatusToManagerEvent,
  type ConversationClient,
  type ManagerEventType,
  type ManagerNotification,
} from './manager-notification';

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
    });
  }

  private async enqueue(
    event: ManagerEventType,
    client: ConversationClient,
    extra: Partial<ManagerNotification>,
  ): Promise<void> {
    const managerTelegramIds = await this.resolveManagers(client.assignedManagerId);
    if (managerTelegramIds.length === 0) {
      this.logger.warn(
        `No linked managers to notify (event=${event}, client=${client.id})`,
      );
      return;
    }
    const payload: ManagerNotification = {
      event,
      managerTelegramIds,
      clientId: client.id,
      clientName: formatClientName(client),
      clientTelegramId: client.telegramId,
      assigned: Boolean(client.assignedManagerId),
      ...extra,
    };
    await this.queue
      .add('manager-notify', payload)
      .catch((err) => this.logger.warn(`Failed to enqueue manager notification`, err));
  }

  /** Назначенный менеджер, иначе все активные привязанные (broadcast). */
  private async resolveManagers(assignedManagerId: string | null): Promise<string[]> {
    if (assignedManagerId) {
      const manager = await this.usersRepo.findOne({
        where: { id: assignedManagerId },
        select: ['managerTelegramId'],
      });
      return manager?.managerTelegramId ? [manager.managerTelegramId] : [];
    }
    const managers = await this.usersRepo.find({
      where: { managerTelegramId: Not(IsNull()), isActive: true },
      select: ['managerTelegramId'],
    });
    return managers
      .map((m) => m.managerTelegramId)
      .filter((id): id is string => Boolean(id));
  }
}
