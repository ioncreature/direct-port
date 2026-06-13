import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { Document } from '../database/entities/document.entity';
import {
  buildDocumentNotificationPayload,
  type DocumentNotification,
  type ProblemRowSummary,
} from './notification';

/**
 * Единая точка отправки уведомлений о состоянии документа из воркеров pipeline
 * (parsing/processing). Раньше метод `notify` был скопирован в обоих процессорах.
 *
 * Best-effort по построению: сбой уведомления (резолв менеджеров в БД, недоступный
 * Redis) НЕ пробрасывается — иначе он долетел бы до catch воркера и флипнул уже
 * сохранённый статус документа (например, PROCESSED → FAILED).
 *
 * Маршрутизация по источнику: managed → менеджеру (manager-bot), self_service →
 * клиенту в Telegram-бот.
 */
@Injectable()
export class PipelineNotifierService {
  private logger = new Logger(PipelineNotifierService.name);

  constructor(
    @InjectQueue('document-notifications') private notificationQueue: Queue,
    private managerNotify: ManagerNotifyService,
  ) {}

  /**
   * Уведомление с понятным `DocumentNotification['status']`. Для managed-документа
   * событие выводится из `doc.status` внутри ManagerNotifyService (переданный status
   * игнорируется); для self_service без telegramId payload пуст — тихо пропускаем.
   */
  async notify(opts: {
    doc: Document;
    status: DocumentNotification['status'];
    errorMessage?: string;
    errorCode?: string;
    sendResultFile?: boolean;
    rejectionReasons?: string[];
    rejectionReasonsLocalized?: string[];
    itemCount?: number;
    problemRows?: ProblemRowSummary[];
  }): Promise<void> {
    try {
      if (opts.doc.source === 'managed') {
        await this.managerNotify.notifyDocumentEvent(opts.doc);
        return;
      }
      const payload = buildDocumentNotificationPayload(opts.doc, opts.status, {
        errorMessage: opts.errorMessage,
        errorCode: opts.errorCode,
        rejectionReasons: opts.rejectionReasons,
        rejectionReasonsLocalized: opts.rejectionReasonsLocalized,
        sendResultFile: opts.sendResultFile,
        itemCount: opts.itemCount,
        problemRows: opts.problemRows,
      });
      if (!payload) return;

      await this.notificationQueue.add('document-ready', payload);
    } catch (err) {
      this.logger.warn(`Failed to send notification for ${opts.doc.id}`, err);
    }
  }

  /**
   * Уведомление ТОЛЬКО менеджеру (managed-флоу) для статусов без аналога в
   * `DocumentNotification['status']` — например REQUIRES_REVIEW: self_service-клиента
   * в этом статусе не уведомляем. Для self_service-документа — no-op. Best-effort.
   */
  async notifyManagerOnly(doc: Document): Promise<void> {
    if (doc.source !== 'managed') return;
    try {
      await this.managerNotify.notifyDocumentEvent(doc);
    } catch (err) {
      this.logger.warn(`Failed to notify manager for ${doc.id}`, err);
    }
  }
}
