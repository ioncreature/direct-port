import { rowNeedsCodeReview } from '../common/confidence';
import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { Document } from '../database/entities/document.entity';

// Wire-format: должен совпадать с ProblemRowSummary в apps/tg-bot/src/bot/handlers/notification.handler.ts.
export interface ProblemRowSummary {
  rowIndex: number;
  description: string;
  tnVedCode?: string;
  matchConfidence?: number;
  missingDataCategories?: string[];
  candidateCodes?: Array<{
    code: string;
    description: string;
    confidence: number;
    dutyRate: number;
    vatRate: number;
  }>;
}

export interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status:
    | 'processed'
    | 'processed_with_errors'
    | 'failed'
    | 'rejected'
    | 'code_review_required'
    | 'stage_classifying';
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
  /** Количество позиций в документе — для stage_classifying. */
  itemCount?: number;
  /** Заполняется только при status='code_review_required'. */
  problemRows?: ProblemRowSummary[];
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
    itemCount?: number;
    problemRows?: ProblemRowSummary[];
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
    itemCount: extra.itemCount,
    problemRows: extra.problemRows,
    language: doc.language ?? doc.telegramUser?.language,
    outputFileName: buildOutputFileName(doc.createdAt, clientName),
    sendResultFile: extra.sendResultFile,
  };
}

export function extractProblemRows(
  rows: Record<string, unknown>[],
  threshold: number,
): ProblemRowSummary[] {
  const result: ProblemRowSummary[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const confidence = Number(row.matchConfidence) || 0;
    if (!rowNeedsCodeReview(row, threshold)) continue;

    const candidates = Array.isArray(row.candidateCodes)
      ? (row.candidateCodes as Array<Record<string, unknown>>).slice(0, 3).map((c) => ({
          code: String(c.code ?? ''),
          description: String(c.description ?? ''),
          confidence: Number(c.confidence) || 0,
          dutyRate: Number(c.dutyRate) || 0,
          vatRate: Number(c.vatRate) || 0,
        }))
      : undefined;

    const missing = Array.isArray(row.missingDataCategories)
      ? (row.missingDataCategories as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;

    result.push({
      rowIndex: i,
      description: String(row.description ?? ''),
      tnVedCode: typeof row.tnVedCode === 'string' && row.tnVedCode ? row.tnVedCode : undefined,
      matchConfidence: confidence || undefined,
      ...(missing && missing.length ? { missingDataCategories: missing } : {}),
      ...(candidates && candidates.length ? { candidateCodes: candidates } : {}),
    });
  }
  return result;
}
