import { DocumentStatus } from '../database/entities/document.entity';
import type { TelegramUser } from '../database/entities/telegram-user.entity';

/**
 * Событие для менеджерского бота (очередь manager-notifications).
 * Wire-format: должен совпадать с обработчиком в apps/manager-bot.
 */
export type ManagerEventType =
  | 'new_document' // клиент прислал файл — ждёт запуска расчёта
  | 'client_message' // клиент написал текст/прислал вложение
  | 'pipeline_done' // расчёт завершён (processed / processed_with_errors)
  | 'pipeline_failed' // ошибка обработки
  | 'pipeline_review' // нужна ручная проверка (requires_review / code_review_required)
  | 'pipeline_rejected' // документ отклонён
  | 'leads_report'; // автономный поиск лидов — текстовый отчёт менеджерам (без клиента)

export interface ManagerNotification {
  event: ManagerEventType;
  /** Telegram ID менеджеров-адресатов (resolved: назначенный или broadcast всем привязанным). */
  managerTelegramIds: string[];
  // Поля клиента есть у всех событий, КРОМЕ leads_report (он не про клиента, а про лидген).
  clientId?: string; // TelegramUser.id (uuid)
  clientName?: string;
  clientTelegramId?: string; // numeric Telegram ID клиента — для справки
  /** Закреплён ли уже менеджер за клиентом (если нет — бот покажет кнопку «Взять»). */
  assigned?: boolean;
  documentId?: string;
  documentName?: string;
  statusLabel?: string; // человекочитаемый статус документа (для pipeline_*)
  text?: string; // текст клиента (client_message) / подпись (new_document) / тело отчёта (leads_report)
  attachmentType?: string; // 'document' | 'photo' | 'file' (для client_message)
  /** Результат готов к отправке клиенту (PROCESSED — download доступен). Для pipeline_done. */
  resultReady?: boolean;
}

/** Человекочитаемое имя клиента для шапки уведомления. */
export function formatClientName(client: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  telegramId: string;
}): string {
  const full = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (client.username) return `@${client.username}`;
  return `id${client.telegramId}`;
}

/**
 * Маппинг финального статуса документа на менеджерское событие.
 * Промежуточные статусы (parsing/pending/processing/intake) → null (менеджеру не шлём).
 */
export function mapDocStatusToManagerEvent(status: DocumentStatus): ManagerEventType | null {
  switch (status) {
    case DocumentStatus.PROCESSED:
    case DocumentStatus.PROCESSED_WITH_ERRORS:
      return 'pipeline_done';
    case DocumentStatus.FAILED:
      return 'pipeline_failed';
    case DocumentStatus.REQUIRES_REVIEW:
    case DocumentStatus.CODE_REVIEW_REQUIRED:
      return 'pipeline_review';
    case DocumentStatus.REJECTED:
      return 'pipeline_rejected';
    default:
      return null;
  }
}

export type ConversationClient = Pick<
  TelegramUser,
  'id' | 'telegramId' | 'firstName' | 'lastName' | 'username' | 'assignedManagerId'
>;
