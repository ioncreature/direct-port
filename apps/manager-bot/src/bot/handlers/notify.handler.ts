import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { InlineKeyboard } from 'grammy';
import { BotRegistry } from '../bot-registry.service';
import { escapeHtml } from '../format';
import { isPermanentDeliveryError } from '../telegram-errors';

// Wire-format: совпадает с ManagerNotification в apps/api/src/conversations/manager-notification.ts.
export type ManagerEventType =
  | 'new_document'
  | 'client_message'
  | 'pipeline_done'
  | 'pipeline_failed'
  | 'pipeline_review'
  | 'pipeline_rejected'
  | 'topup_request'
  | 'leads_report';

export interface ManagerNotification {
  event: ManagerEventType;
  companyId?: string;
  managerTelegramIds: string[];
  clientId?: string;
  clientName?: string;
  clientTelegramId?: string;
  assigned?: boolean;
  documentId?: string;
  documentName?: string;
  statusLabel?: string;
  reason?: string;
  text?: string;
  attachmentType?: string;
  resultReady?: boolean;
  topUpId?: string;
  positions?: number;
  amount?: number;
  currency?: string;
}

/** Текст уведомления менеджеру (HTML) по типу события. */
export function buildNotificationText(n: ManagerNotification): string {
  if (n.event === 'leads_report') {
    // Отчёт лидген-агента — тело приходит готовым, экранируем как plain-текст.
    return `🔎 <b>Поиск лидов</b>\n${escapeHtml(n.text ?? 'отчёт пуст')}`;
  }
  const client = `<b>${escapeHtml(n.clientName ?? '')}</b>`;
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
      return `❌ Ошибка обработки — ${doc}\nКлиент: ${client}${n.reason ? `\n${escapeHtml(n.reason)}` : ''}`;
    case 'pipeline_review':
      return `⚠️ Требует проверки — ${doc}\nКлиент: ${client}`;
    case 'pipeline_rejected':
      return `🚫 Документ отклонён — ${doc}\nКлиент: ${client}`;
    case 'topup_request': {
      const positions = n.positions ?? 0;
      const amount = `${n.amount ?? 0} ${escapeHtml(n.currency ?? '')}`.trim();
      return `💳 Заявка на пополнение от ${client}\n${positions} поз. — ${amount}\nПодтвердите после поступления оплаты.`;
    }
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
  if (n.event === 'leads_report') {
    return kb.url('↗️ Лиды в админке', `${adminBase}/leads`);
  }
  if (n.event === 'new_document') {
    if (n.documentId) kb.text('🚀 Запустить расчёт', `start:${n.documentId}`).row();
    if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
    if (n.documentId) kb.url('↗️ В админке', `${adminBase}/documents/${n.documentId}`);
  } else if (n.event === 'client_message') {
    kb.text('✍️ Ответить', `reply:${n.clientId}`).row();
    if (!n.assigned) kb.text('👤 Взять', `claim:${n.clientId}`).row();
    kb.url('↗️ В админке', `${adminBase}/telegram-users/${n.clientId}`);
  } else if (n.event === 'topup_request' && n.topUpId) {
    kb.text('✅ Подтвердить оплату', `confirm-topup:${n.topUpId}`).row();
    kb.text('🚫 Отклонить', `cancel-topup:${n.topUpId}`).row();
    if (n.clientId) kb.url('↗️ В админке', `${adminBase}/telegram-users/${n.clientId}`);
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
  private adminBase: string;

  constructor(
    config: ConfigService,
    private registry: BotRegistry,
  ) {
    super();
    this.adminBase = config.get<string>('ADMIN_WEB_BASE_URL', 'http://localhost:3000');
  }

  async process(job: Job<ManagerNotification>): Promise<void> {
    const n = job.data;
    // Доставляем через manager-bot компании (по companyId); дефолтный — fallback.
    const api = this.registry.getApi(n.companyId);
    if (!api) {
      // failed-job виден в Redis — лучше, чем «успешно» проглоченное событие клиента.
      throw new UnrecoverableError('No manager bot available to deliver notification');
    }
    const text = buildNotificationText(n);
    const keyboard = buildNotificationKeyboard(n, this.adminBase);
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
