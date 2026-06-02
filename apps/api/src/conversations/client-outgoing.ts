/**
 * Исходящее сообщение клиенту (очередь client-bot-outgoing, потребляет client-bot).
 * Доставляет клиенту ответ менеджера.
 */
export interface ClientOutgoingMessage {
  clientTelegramId: string; // numeric Telegram ID клиента
  text: string;
  language?: string;
}
