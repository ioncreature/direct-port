import type { DepositTransactionType, TopUpStatus } from './types';

/** Целое число позиций с разделителями разрядов. */
export function fmtInt(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** Денежная сумма с валютой (для заявок на пополнение). */
export function fmtMoney(amount: number, currency: string): string {
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`;
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
