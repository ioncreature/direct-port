export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatClientName(c: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  telegramId?: string;
}): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (c.username) return `@${c.username}`;
  return c.telegramId ? `id${c.telegramId}` : 'клиент';
}
