export function buildOutputFileName(createdAt: Date, clientName: string): string {
  const prefix = 'DP';
  const y = createdAt.getFullYear();
  const m = String(createdAt.getMonth() + 1).padStart(2, '0');
  const d = String(createdAt.getDate()).padStart(2, '0');
  const h = String(createdAt.getHours()).padStart(2, '0');
  const min = String(createdAt.getMinutes()).padStart(2, '0');
  const dateTime = `${y}-${m}-${d}_${h}-${min}`;

  const sanitized = clientName
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 10);

  const parts = [prefix, dateTime];
  if (sanitized) parts.push(sanitized);
  return parts.join('_') + '.xlsx';
}

export function getDocumentClientName(doc: {
  telegramUser?: { firstName?: string | null; lastName?: string | null; username?: string | null } | null;
  uploadedBy?: { email: string } | null;
}): string {
  if (doc.telegramUser) {
    const name = [doc.telegramUser.firstName, doc.telegramUser.lastName]
      .filter(Boolean)
      .join('_');
    return name || doc.telegramUser.username || '';
  }
  if (doc.uploadedBy) {
    return doc.uploadedBy.email.split('@')[0];
  }
  return '';
}
