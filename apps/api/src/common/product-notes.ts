/**
 * Сквозные заметки, которые каждый этап pipeline может оставить на товаре.
 * Назначение — прозрачно довести до пользователя (декларанта или клиента в боте),
 * что в расчёте не сходится, какое уточнение требуется и почему именно такая цифра.
 *
 * Правила:
 * - Заметки только добавляются, никогда не стираются
 * - severity='blocker' означает, что без уточнения расчёт неполный (например, не хватает площади для специфической пошлины)
 * - severity='warning' — расчёт выполнен, но есть сомнения (низкий confidence классификатора, Claude предложил альтернативный код, и т.п.)
 * - severity='info' — нейтральная подсказка, не влияет на корректность
 */

export type ProductNoteStage = 'parse' | 'classify' | 'verify' | 'interpret' | 'calculate';

export type ProductNoteSeverity = 'info' | 'warning' | 'blocker';

export interface ProductNote {
  stage: ProductNoteStage;
  severity: ProductNoteSeverity;
  /** Человекочитаемое сообщение на русском. Показывается в Excel и в админке. */
  message: string;
  /** Сообщение на языке пользователя (если document.language !== 'ru'). */
  messageLocalized?: string;
  /** Какое поле затронуто: 'duty' | 'vat' | 'excise' | 'code' | 'dimensions' | ... */
  field?: string;
}

/**
 * Агрегированный статус расчёта, выводимый из notes.
 * Заменяет предыдущий verificationStatus, который показывал только качество матча TKS.
 */
export type CalculationStatus = 'exact' | 'partial' | 'needs_info' | 'error';

/**
 * Вычисление итогового статуса расчёта из списка заметок.
 * - error  — если есть blocker с field='code' (не смогли классифицировать)
 * - needs_info — если есть blocker (не хватает dimensions, не смогли посчитать пошлину)
 * - partial — если есть warning
 * - exact — иначе
 */
export function resolveCalculationStatus(notes: ProductNote[]): CalculationStatus {
  let hasBlocker = false;
  let hasWarning = false;
  let hasCodeBlocker = false;

  for (const note of notes) {
    if (note.severity === 'blocker') {
      hasBlocker = true;
      if (note.field === 'code') {
        hasCodeBlocker = true;
      }
    } else if (note.severity === 'warning') {
      hasWarning = true;
    }
  }

  if (hasCodeBlocker) return 'error';
  if (hasBlocker) return 'needs_info';
  if (hasWarning) return 'partial';
  return 'exact';
}
