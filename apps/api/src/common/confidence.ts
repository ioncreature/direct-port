export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Единый критерий «строка требует ревью кода ТН ВЭД». Используется при выборе статуса
 * документа (CODE_REVIEW_REQUIRED/REJECTED), в problemRows для бота и при пересчётах.
 *
 * Строка требует ревью, если:
 *  - код не найден в TKS (matched=false), либо
 *  - AI-классификация не отработала (verified=false) — тогда matchConfidence отражает
 *    лишь частотность кода в TKS-поиске, а не качество матча, и доверять ей нельзя, либо
 *  - уверенность ниже порога.
 *
 * Отсутствующее поле verified (legacy resultData до объединения classify+verify)
 * трактуем как true: такие документы уже прошли первичную обработку и ревью.
 */
export function rowNeedsCodeReview(
  row: { matched?: unknown; verified?: unknown; matchConfidence?: unknown },
  threshold: number,
): boolean {
  const matched = Boolean(row.matched);
  const verified = Boolean(row.verified ?? true);
  const confidence = Number(row.matchConfidence) || 0;
  return !matched || !verified || confidence < threshold;
}
