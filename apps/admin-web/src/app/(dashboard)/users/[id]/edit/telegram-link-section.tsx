'use client';

import { useManagerLink } from '@/hooks/use-manager-link';
import type { User } from '@/lib/types';
import { useState } from 'react';

/** Секция привязки менеджерского Telegram к аккаунту (для manager-bot). */
export function TelegramLinkSection({ user }: { user: User }) {
  const { token, loading, error, createToken, unlink } = useManagerLink(user.id);
  const [linkedTelegramId, setLinkedTelegramId] = useState(user.managerTelegramId);

  const handleUnlink = async () => {
    if (!confirm('Отвязать Telegram менеджера?')) return;
    try {
      await unlink();
      setLinkedTelegramId(null);
    } catch {
      // ошибка показана через error
    }
  };

  return (
    <div
      style={{
        marginTop: 32,
        maxWidth: 500,
        borderTop: '1px solid var(--border)',
        paddingTop: 24,
      }}
    >
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Telegram менеджера</h2>
      {linkedTelegramId ? (
        <div>
          <p style={{ marginBottom: 12 }}>
            Привязан Telegram ID: <b>{linkedTelegramId}</b>
          </p>
          <button
            onClick={handleUnlink}
            disabled={loading}
            style={{ padding: '8px 16px', cursor: 'pointer' }}
          >
            {loading ? '...' : 'Отвязать'}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            Чтобы менеджер получал уведомления и общался с клиентами в боте, привяжите его
            Telegram-аккаунт.
          </p>
          <button
            onClick={createToken}
            disabled={loading}
            style={{ padding: '8px 16px', cursor: 'pointer' }}
          >
            {loading ? 'Создание...' : 'Привязать Telegram'}
          </button>
          {token && (
            <div
              style={{ marginTop: 12, padding: 12, background: 'var(--bg-subtle)', borderRadius: 8 }}
            >
              <p style={{ marginBottom: 8 }}>
                Отправьте менеджеру ссылку (действует 15 минут):
              </p>
              {token.deepLink.startsWith('http') ? (
                <a
                  href={token.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent)', wordBreak: 'break-all' }}
                >
                  {token.deepLink}
                </a>
              ) : (
                <p style={{ fontSize: 13 }}>
                  Бот не настроен (MANAGER_BOT_USERNAME). Менеджер должен отправить боту:{' '}
                  <code>/start {token.token}</code>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
