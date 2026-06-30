import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { ClientOutgoingMessage } from '../conversations/client-outgoing';
import { mapDocStatusToManagerEvent } from '../conversations/manager-notification';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { DELIVERY_JOB_OPTS } from '../conversations/queue-opts';
import { Document, DocumentStatus } from '../database/entities/document.entity';

/**
 * Единая точка уведомлений о состоянии документа из pipeline-воркеров и админских
 * операций (approve/reject/reprocess/ручная правка кода). Адресат выводится из
 * `doc.source`:
 *
 * - `managed` — менеджеру в manager-bot (конкретное событие из `doc.status`).
 * - `self_service` + `telegramUserId` — самому клиенту в его client-bot (документ
 *   загружен из кабинета). PROCESSED → доставляем готовый Excel; прочие терминальные
 *   статусы → текстовый нудж «откройте кабинет». Промежуточные статусы не шлём.
 * - `self_service` без `telegramUserId` (legacy + админская загрузка) — бота-получателя
 *   нет, это no-op.
 *
 * Best-effort по построению: сбой уведомления (резолв адресата в БД, недоступный
 * Redis) НЕ пробрасывается — иначе он долетел бы до catch воркера и флипнул уже
 * сохранённый статус документа (например, PROCESSED → FAILED) или до HTTP-ответа
 * админской операции, хотя сам документ уже сохранён.
 */
@Injectable()
export class PipelineNotifierService {
  private logger = new Logger(PipelineNotifierService.name);

  constructor(
    private managerNotify: ManagerNotifyService,
    @InjectQueue('client-bot-outgoing') private clientOutQueue: Queue,
  ) {}

  async notify(doc: Document): Promise<void> {
    if (doc.source === 'managed') {
      try {
        await this.managerNotify.notifyDocumentEvent(doc);
      } catch (err) {
        this.logger.warn(`Failed to notify manager for document ${doc.id}`, err);
      }
      return;
    }
    // Кабинетная self-service-загрузка отличается от админской наличием telegramUserId
    // (у админской он null). Уведомляем только её — у админских загрузок клиента-получателя нет.
    if (doc.source === 'self_service' && doc.telegramUserId) {
      try {
        await this.notifyClient(doc);
      } catch (err) {
        this.logger.warn(`Failed to notify cabinet client for document ${doc.id}`, err);
      }
    }
  }

  /**
   * Уведомление клиента кабинета о финальном статусе его документа. Промежуточные
   * статусы (parsing/pending/processing) отсекаются тем же маппером, что и для менеджера.
   */
  private async notifyClient(doc: Document): Promise<void> {
    if (!mapDocStatusToManagerEvent(doc.status)) return; // промежуточный статус — не шлём
    // Все вызывающие notify() грузят relation telegramUser (как и ManagerNotifyService),
    // поэтому берём его напрямую — отдельного запроса к БД не нужно.
    const client = doc.telegramUser;
    if (!client) return;
    const base: ClientOutgoingMessage = {
      companyId: client.companyId,
      clientTelegramId: client.telegramId,
      language: client.language,
    };
    // PROCESSED → отдаём готовый Excel (download-internal доступен только для него);
    // прочие терминальные (failed/review/with_errors/rejected) — нудж в кабинет.
    const payload: ClientOutgoingMessage =
      doc.status === DocumentStatus.PROCESSED
        ? { ...base, documentId: doc.id, documentFileName: doc.originalFileName }
        : { ...base, i18nKey: 'cabinet-doc-issue' };
    await this.clientOutQueue.add('client-message', payload, DELIVERY_JOB_OPTS);
  }
}
