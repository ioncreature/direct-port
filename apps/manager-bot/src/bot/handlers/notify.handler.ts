import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api, InlineKeyboard } from 'grammy';
import { escapeHtml } from '../format';

// Wire-format: совпадает с ManagerNotification в apps/api/src/conversations/manager-notification.ts.
type ManagerEventType =
  | 'new_document'
  | 'client_message'
  | 'pipeline_done'
  | 'pipeline_failed'
  | 'pipeline_review'
  | 'pipeline_rejected';

interface ManagerNotification {
  event: ManagerEventType;
  managerTelegramIds: string[];
  clientId: string;
  clientName: string;
  clientTelegramId: string;
  assigned: boolean;
  documentId?: string;
  documentName?: string;
  statusLabel?: string;
  text?: string;
  attachmentType?: string;
}

/** Доставляет события клиентов менеджерам (очередь manager-notifications). */
@Injectable()
@Processor('manager-notifications')
export class NotifyHandler extends WorkerHost {
  private logger = new Logger(NotifyHandler.name);
  private tgApi: Api | null;
  private adminBase: string;

  constructor(config: ConfigService) {
    super();
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.tgApi = token ? new Api(token) : null;
    this.adminBase = config.get<string>('ADMIN_WEB_BASE_URL', 'http://localhost:3000');
  }

  async process(job: Job<ManagerNotification>): Promise<void> {
    const n = job.data;
    if (!this.tgApi) {
      this.logger.warn('Bot token not configured, skipping manager notification');
      return;
    }
    const text = this.buildText(n);
    const keyboard = this.buildKeyboard(n);
    const api = this.tgApi;
    // Broadcast параллельно: каждый sendMessage независим, .catch локализует сбой.
    await Promise.all(
      n.managerTelegramIds.map((managerTelegramId) =>
        api
          .sendMessage(managerTelegramId, text, { reply_markup: keyboard, parse_mode: 'HTML' })
          .catch((err) =>
            this.logger.error(`Failed to notify manager ${managerTelegramId}`, err),
          ),
      ),
    );
  }

  private buildText(n: ManagerNotification): string {
    const client = `<b>${escapeHtml(n.clientName)}</b>`;
    const doc = escapeHtml(n.documentName ?? 'файл');
    switch (n.event) {
      case 'new_document':
        return `📄 Новый файл от ${client}\nФайл: ${doc}`;
      case 'client_message': {
        const body = n.text
          ? escapeHtml(n.text)
          : n.attachmentType
            ? `[вложение: ${escapeHtml(n.attachmentType)}]`
            : '[сообщение]';
        return `💬 ${client}:\n${body}`;
      }
      case 'pipeline_done':
        return `✅ Расчёт готов — ${doc}\nКлиент: ${client}${n.statusLabel ? `\nСтатус: ${escapeHtml(n.statusLabel)}` : ''}`;
      case 'pipeline_failed':
        return `❌ Ошибка обработки — ${doc}\nКлиент: ${client}`;
      case 'pipeline_review':
        return `⚠️ Требует проверки — ${doc}\nКлиент: ${client}`;
      case 'pipeline_rejected':
        return `🚫 Документ отклонён — ${doc}\nКлиент: ${client}`;
      default:
        return `Событие по клиенту ${client}`;
    }
  }

  private buildKeyboard(n: ManagerNotification): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (n.event === 'new_document') {
      if (n.documentId) kb.text('🚀 Запустить расчёт', `start:${n.documentId}`).row();
      if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
      if (n.documentId) kb.url('↗️ В админке', `${this.adminBase}/documents/${n.documentId}`);
    } else if (n.event === 'client_message') {
      kb.text('✍️ Ответить', `reply:${n.clientId}`).row();
      if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
      kb.url('↗️ В админке', `${this.adminBase}/telegram-users/${n.clientId}`);
    } else if (n.documentId) {
      kb.url('↗️ Открыть в админке', `${this.adminBase}/documents/${n.documentId}`);
    }
    return kb;
  }
}
