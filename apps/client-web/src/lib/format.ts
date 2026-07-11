import type { DepositTransactionType, TopUpStatus } from './types';

/** Целое число позиций с разделителями разрядов. */
export function fmtInt(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** Денежная сумма с валютой (для заявок на пополнение). */
export function fmtMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`;
}

/** Рублёвая сумма (для построчного расчёта в деталях документа). */
export function fmtRub(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

export const TOP_UP_STATUS_LABELS: Record<TopUpStatus, string> = {
  pending: 'Ожидает оплаты',
  confirmed: 'Зачислено',
  canceled: 'Отменена',
};

export function topUpStatusTone(status: TopUpStatus): 'ok' | 'warn' | 'neutral' {
  if (status === 'confirmed') return 'ok';
  if (status === 'pending') return 'warn';
  return 'neutral';
}

/** Знаковая дельта позиций для истории операций. */
export function fmtDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${fmtInt(n)}`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const TRANSACTION_LABELS: Record<DepositTransactionType, string> = {
  topup: 'Пополнение',
  grant: 'Бонусные позиции',
  charge: 'Списание за обработку',
  adjustment: 'Корректировка',
};

/** Цвет бейджа статуса документа (синхронизирован с DocumentStatus в API). */
export function statusTone(status: string): 'ok' | 'warn' | 'error' | 'neutral' {
  switch (status) {
    case 'processed':
      return 'ok';
    case 'failed':
    case 'rejected':
      return 'error';
    case 'processed_with_errors':
    case 'requires_review':
    case 'code_review_required':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** Документ активно обрабатывается pipeline'ом — кабинет часто поллит статус, пока такие есть. */
const IN_PROGRESS_STATUSES = new Set(['parsing', 'pending', 'processing']);

export function isInProgress(status: string): boolean {
  return IN_PROGRESS_STATUSES.has(status);
}

/**
 * Документ ждёт действий менеджера (запуск managed-расчёта, ручная проверка данных или кодов).
 * Статус меняется решением человека, а не сам по себе — кабинет поллит такие документы редко,
 * только чтобы подхватить переход без ручного обновления страницы.
 */
const AWAITING_MANAGER_STATUSES = new Set(['intake', 'requires_review', 'code_review_required']);

export function isAwaitingManager(status: string): boolean {
  return AWAITING_MANAGER_STATUSES.has(status);
}

/** Пояснение под бейджем статуса — что происходит и почему от клиента не требуется действий. */
const STATUS_HINTS: Record<string, string> = {
  intake: 'Файл у менеджера — он запустит расчёт и свяжется с вами.',
  requires_review: 'Менеджер проверяет распознанные данные — расчёт продолжится автоматически.',
  code_review_required: 'Менеджер уточняет коды ТН ВЭД — расчёт продолжится автоматически.',
};

export function statusHint(status: string): string | null {
  return STATUS_HINTS[status] ?? null;
}

/** Метка построчного статуса расчёта (calculationStatus в resultData). */
export const CALC_STATUS_LABELS: Record<string, string> = {
  exact: 'Точно',
  partial: 'С замечаниями',
  needs_info: 'Нужны данные',
  error: 'Код не определён',
};

export function calcStatusTone(status: string | undefined): 'ok' | 'warn' | 'error' | 'neutral' {
  switch (status) {
    case 'exact':
      return 'ok';
    case 'partial':
      return 'warn';
    case 'needs_info':
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}
