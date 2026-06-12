import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { Api, InlineKeyboard } from 'grammy';
import { escapeHtml } from '../format';
import { isPermanentDeliveryError } from '../telegram-errors';

// Wire-format: совпадает с ManagerNotification в apps/api/src/conversations/manager-notification.ts.
export type ManagerEventType =
  | 'new_document'
  | 'client_message'
  | 'pipeline_done'
  | 'pipeline_failed'
  | 'pipeline_review'
  | 'pipeline_rejected';

export interface ManagerNotification {
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
  resultReady?: boolean;
}

/** Текст уведомления менеджеру (HTML) по типу события. */
export function buildNotificationText(n: ManagerNotification): string {
  const client = `<b>${escapeHtml(n.clientName)}</b>`;
  const doc = escapeHtml(n.documentName ?? 'файл');
  switch (n.event) {
    case 'new_document': {
      const caption = n.text ? `\n💬 ${escapeHtml(n.text)}` : '';
      return `📄 Новый файл от ${client}\nФайл: ${doc}${caption}`;
    }
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

/** Inline-кнопки уведомления по типу события (deep-link через adminBase). */
export function buildNotificationKeyboard(
  n: ManagerNotification,
  adminBase: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (n.event === 'new_document') {
    if (n.documentId) kb.text('🚀 Запустить расчёт', `start:${n.documentId}`).row();
    if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
    if (n.documentId) kb.url('↗️ В админке', `${adminBase}/documents/${n.documentId}`);
  } else if (n.event === 'client_message') {
    kb.text('✍️ Ответить', `reply:${n.clientId}`).row();
    if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
    kb.url('↗️ В админке', `${adminBase}/telegram-users/${n.clientId}`);
  } else if (n.documentId) {
    if (n.event === 'pipeline_done' && n.resultReady) {
      kb.text('📤 Отправить клиенту', `send:${n.documentId}`).row();
    }
    kb.url('↗️ Открыть в админке', `${adminBase}/documents/${n.documentId}`);
  }
  return kb;
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
      // failed-job виден в Redis — лучше, чем «успешно» проглоченное событие клиента.
      throw new UnrecoverableError('Bot token not configured, cannot deliver manager notification');
    }
    const text = buildNotificationText(n);
    const keyboard = buildNotificationKeyboard(n, this.adminBase);
    const api = this.tgApi;
    // Broadcast параллельно: каждый sendMessage независим, сбой одного адресата
    // не мешает остальным.
    const results = await Promise.allSettled(
      n.managerTelegramIds.map((managerTelegramId) =>
        api.sendMessage(managerTelegramId, text, { reply_markup: keyboard, parse_mode: 'HTML' }),
      ),
    );

    const failures = results.flatMap((r, i) =>
      r.status === 'rejected' ? [{ reason: r.reason, managerTelegramId: n.managerTelegramIds[i] }] : [],
    );
    for (const { reason, managerTelegramId } of failures) {
      this.logger.error(`Failed to notify manager ${managerTelegramId}`, reason);
    }

    // Частичный успех — job завершаем: ретрай продублировал бы уведомление тем,
    // кто его уже получил. Но если НЕ доставлено никому и среди ошибок есть
    // временные (429/5xx/сеть) — бросаем, чтобы BullMQ ретраил: дублей не будет,
    // а молча потерянное событие для единственного назначенного менеджера —
    // это потерянный клиентский запрос.
    const delivered = results.length - failures.length;
    const transient = failures.find(({ reason }) => !isPermanentDeliveryError(reason));
    if (delivered === 0 && transient) {
      throw transient.reason;
    }
  }
}
