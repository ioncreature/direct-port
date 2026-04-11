import api from './api';
import type { DocumentStatus } from './types';

export const statusLabels: Record<DocumentStatus, string> = {
  parsing: 'Распознавание...',
  pending: 'Ожидает',
  processing: 'Обработка...',
  processed: 'Обработан',
  failed: 'Ошибка',
  requires_review: 'На проверку',
};

export const statusColors: Record<DocumentStatus, string> = {
  parsing: '#8b5cf6',
  pending: '#888',
  processing: '#2563eb',
  processed: '#16a34a',
  failed: '#dc2626',
  requires_review: '#ca8a04',
};

export async function downloadDocument(id: string, fileName: string) {
  const response = await api.get(`/documents/${id}/download`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
