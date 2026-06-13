import { Injectable, Logger } from '@nestjs/common';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { Document } from '../database/entities/document.entity';

/**
 * Единая точка уведомлений о состоянии документа из pipeline-воркеров и админских
 * операций (approve/reject/reprocess/ручная правка кода).
 *
 * После удаления tg-bot (self_service-бот) уведомляются ТОЛЬКО managed-документы —
 * менеджеру в manager-bot; конкретное событие выводится из `doc.status` внутри
 * ManagerNotifyService. У self_service-документов (legacy + админская загрузка)
 * бота-получателя нет — для них это no-op.
 *
 * Best-effort по построению: сбой уведомления (резолв менеджеров в БД, недоступный
 * Redis) НЕ пробрасывается — иначе он долетел бы до catch воркера и флипнул уже
 * сохранённый статус документа (например, PROCESSED → FAILED) или до HTTP-ответа
 * админской операции, хотя сам документ уже сохранён.
 */
@Injectable()
export class PipelineNotifierService {
  private logger = new Logger(PipelineNotifierService.name);

  constructor(private managerNotify: ManagerNotifyService) {}

  async notify(doc: Document): Promise<void> {
    if (doc.source !== 'managed') return;
    try {
      await this.managerNotify.notifyDocumentEvent(doc);
    } catch (err) {
      this.logger.warn(`Failed to notify manager for document ${doc.id}`, err);
    }
  }
}
