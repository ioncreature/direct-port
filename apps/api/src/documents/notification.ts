import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { Document } from '../database/entities/document.entity';

export interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'processed_with_errors' | 'failed' | 'rejected' | 'code_review_required';
  errorMessage?: string;
  rejectionReasons?: string[];
  language?: string;
  outputFileName?: string;
  sendResultFile?: boolean;
}

export function buildDocumentNotificationPayload(
  doc: Document,
  status: DocumentNotification['status'],
  extra: {
    errorMessage?: string;
    rejectionReasons?: string[];
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
    rejectionReasons: extra.rejectionReasons,
    language: doc.language ?? doc.telegramUser?.language,
    outputFileName: buildOutputFileName(doc.createdAt, clientName),
    sendResultFile: extra.sendResultFile,
  };
}
