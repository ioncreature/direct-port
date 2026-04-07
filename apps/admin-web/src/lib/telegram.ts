export function getTelegramName(u: { username: string | null; firstName: string | null; lastName: string | null }): string {
  if (u.username) return `@${u.username}`;
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
}

export function getDocumentUploaderName(doc: {
  telegramUser: { username: string | null; firstName: string | null; lastName: string | null } | null;
  uploadedBy?: { email: string } | null;
}): string {
  if (doc.telegramUser) return getTelegramName(doc.telegramUser);
  return doc.uploadedBy?.email ?? 'Админ';
}
