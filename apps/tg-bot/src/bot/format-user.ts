import { Context } from 'grammy';

export function formatUser(ctx: Context): string {
  const from = ctx.from;
  if (!from) return '';
  const username = from.username ? `@${from.username}` : from.first_name || 'no-name';
  return `${username} (id=${from.id})`;
}
