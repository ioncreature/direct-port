/** ISO YYYY-MM-DD → DD.MM.YYYY. Любой нераспознанный формат возвращается как есть. */
export function formatIsoDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : raw;
}

export function formatPeriod(begin: string | null, end: string | null): string {
  if (!begin && !end) return '—';
  const beginStr = begin ? formatIsoDate(begin) : '—';
  const endStr = end ? formatIsoDate(end) : '—';
  return `${beginStr} … ${endStr}`;
}
