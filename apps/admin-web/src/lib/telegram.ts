export function getTelegramName(u: { username: string | null; firstName: string | null; lastName: string | null }): string {
  if (u.username) return `@${u.username}`;
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
}
