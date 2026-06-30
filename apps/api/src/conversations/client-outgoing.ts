/**
 * Исходящее сообщение клиенту (очередь client-bot-outgoing, потребляет client-bot).
 * Доставляет клиенту ответ менеджера: текст и/или готовый расчёт (Excel).
 */
export interface ClientOutgoingMessage {
  /**
   * Компания-владелец клиента: client-bot доставляет сообщение через бот ИМЕННО этой
   * компании (реестр ботов выбирает Api по companyId). См. docs/COMPANY_BOTS.md.
   */
  companyId: string;
  clientTelegramId: string; // numeric Telegram ID клиента
  language?: string;
  /** Текст ответа менеджера. Необязателен, если доставляем документ. */
  text?: string;
  /** Если задан — client-bot скачает Excel результата (download-internal) и отправит его клиенту. */
  documentId?: string;
  /** Имя исходного файла — для осмысленного имени документа у клиента. */
  documentFileName?: string;
  /** Ключ локали для системного уведомления — client-bot локализует его по language. */
  i18nKey?: string;
}
