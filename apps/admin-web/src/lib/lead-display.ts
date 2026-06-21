import type { LeadSearchStatus, LeadSource, LeadStatus } from './types';

export const SOURCE_LABELS: Record<LeadSource, string> = {
  fts_registry: 'Реестр ФТС',
  web_search: 'Веб-поиск',
  manual: 'Вручную',
  import: 'Импорт',
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Новый',
  enriching: 'Обогащение',
  enriched: 'Обогащён',
  in_progress: 'В работе',
  contacted: 'Связались',
  qualified: 'Квалифицирован',
  rejected: 'Отклонён',
  failed: 'Ошибка',
};

export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'var(--text-muted)',
  enriching: 'var(--warning)',
  enriched: 'var(--accent)',
  in_progress: '#7c3aed',
  contacted: '#0891b2',
  qualified: 'var(--success)',
  rejected: 'var(--danger)',
  failed: 'var(--danger)',
};

/** Статусы, которые менеджер ставит вручную на странице лида. */
export const MANAGER_STATUS_OPTIONS: LeadStatus[] = [
  'enriched',
  'in_progress',
  'contacted',
  'qualified',
  'rejected',
];

export const SEARCH_STATUS_COLORS: Record<LeadSearchStatus, string> = {
  running: 'var(--warning)',
  completed: 'var(--text-muted)',
  failed: 'var(--danger)',
};

export function scoreColor(s: number | null): string {
  if (s == null) return 'var(--text-subtle)';
  if (s >= 0.7) return 'var(--success)';
  if (s >= 0.4) return 'var(--warning)';
  return 'var(--text-muted)';
}
