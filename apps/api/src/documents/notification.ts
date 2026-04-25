import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { Document } from '../database/entities/document.entity';

export interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'processed_with_errors' | 'failed' | 'rejected' | 'code_review_required';
  /**
   * Произвольный текст ошибки (от оператора-человека или fallback).
   * Бот показывает как есть, без перевода.
   */
  errorMessage?: string;
  /**
   * Машиночитаемый код ошибки. Бот мапит на ключ `error-{code}` в Fluent —
   * это позволяет показать локализованное сообщение вместо технического
   * `errorMessage` (который остаётся в БД для админки).
   */
  errorCode?: string;
  /** Причины отклонения на русском (для совместимости и логов). */
  rejectionReasons?: string[];
  /**
   * Причины отклонения на языке пользователя бота (язык документа).
   * Если задано, бот покажет именно эти строки; иначе использует rejectionReasons.
   */
  rejectionReasonsLocalized?: string[];
  language?: string;
  outputFileName?: string;
  sendResultFile?: boolean;
}

export function buildDocumentNotificationPayload(
  doc: Document,
  status: DocumentNotification['status'],
  extra: {
    errorMessage?: string;
    errorCode?: string;
    rejectionReasons?: string[];
    rejectionReasonsLocalized?: string[];
    sendResultFile?: boolean;
  } = {},
): DocumentNotification | null {
  const telegramId = doc.telegramUser?.telegramId;
  if (!telegramId) return null;

  const clientName = getDocumentClientName(doc);
  return {
    documentId: doc.id,
    telegramUserId: telegramId,
    status,
    errorMessage: extra.errorMessage,
    errorCode: extra.errorCode,
    rejectionReasons: extra.rejectionReasons,
    rejectionReasonsLocalized: extra.rejectionReasonsLocalized,
    language: doc.language ?? doc.telegramUser?.language,
    outputFileName: buildOutputFileName(doc.createdAt, clientName),
    sendResultFile: extra.sendResultFile,
  };
}
