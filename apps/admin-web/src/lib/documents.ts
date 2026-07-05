import api from './api';
import type { CountryOriginSource, DocumentStatus } from './types';

export const countryOriginSourceLabels: Record<CountryOriginSource, string> = {
  ai_explicit: 'AI нашёл прямое упоминание в документе',
  ai_language: 'AI определил по языку описания',
  ai_currency: 'AI определил по валюте',
  manual: 'выбрано оператором',
  default: 'не определено, применён Китай по умолчанию',
};

export const statusLabels: Record<DocumentStatus, string> = {
  intake: 'Входящий',
  parsing: 'Распознавание...',
  pending: 'Ожидает',
  processing: 'Обработка...',
  processed: 'Обработан',
  processed_with_errors: 'Обработан частично',
  failed: 'Сбой обработки',
  rejected: 'Отклонён',
  requires_review: 'На проверку',
  code_review_required: 'Проверка кодов',
};

export const statusColors: Record<DocumentStatus, string> = {
  intake: 'var(--petrol)',
  parsing: 'var(--violet)',
  pending: 'var(--text-subtle)',
  processing: '#3e6f96',
  processed: 'var(--success)',
  processed_with_errors: '#bc6d1d',
  failed: 'var(--danger)',
  rejected: 'var(--orange-strong)',
  requires_review: 'var(--warning)',
  code_review_required: 'var(--warning)',
};

export async function downloadDocument(id: string) {
  const response = await api.get(`/documents/${id}/download`, {
    responseType: 'blob',
  });

  let fileName = `document_${id.slice(0, 8)}.xlsx`;
  const disposition = response.headers['content-disposition'] as string | undefined;
  if (disposition) {
    const rfc5987 = disposition.match(/filename\*=UTF-8''([^;\s]+)/i);
    const plain = disposition.match(/filename="([^"]+)"/i);
    const extracted = rfc5987?.[1] ?? plain?.[1];
    if (extracted) fileName = decodeURIComponent(extracted);
  }

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
