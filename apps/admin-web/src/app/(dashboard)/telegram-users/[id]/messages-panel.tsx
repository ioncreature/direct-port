'use client';

import { useConversation } from '@/hooks/use-conversation';
import { fmtDateTimeLocale } from '@/lib/format';
import Link from 'next/link';

function attachmentLabel(type: string): string {
  if (type === 'document') return 'файл';
  if (type === 'photo') return 'фото';
  return 'вложение';
}

/** Read-only лента переписки клиента с менеджерами. */
export function MessagesPanel({ clientId }: { clientId: string }) {
  const { messages, loading, error } = useConversation(clientId);

  if (loading) return <p>Загрузка...</p>;
  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (messages.length === 0)
    return <p style={{ color: 'var(--text-muted)' }}>Переписки пока нет.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
      {messages.map((m) => {
        const fromClient = m.direction === 'client_to_manager';
        return (
          <div
            key={m.id}
            style={{ alignSelf: fromClient ? 'flex-start' : 'flex-end', maxWidth: '80%' }}
          >
            <div
              style={{
                background: fromClient ? 'var(--bg)' : 'var(--accent-soft)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                {fromClient ? 'Клиент' : (m.manager?.email ?? 'Менеджер')} ·{' '}
                {fmtDateTimeLocale(m.createdAt)}
              </div>
              {m.text && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
              {m.attachmentType && (
                <div style={{ fontSize: 13, color: 'var(--text)' }}>
                  📎 {attachmentLabel(m.attachmentType)}
                  {m.documentId && (
                    <>
                      {' '}
                      —{' '}
                      <Link href={`/documents/${m.documentId}`} style={{ color: 'var(--accent)' }}>
                        открыть документ
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
