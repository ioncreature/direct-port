'use client';

import { type BotLink, useBotLinks } from '@/hooks/use-bot-links';
import type { CSSProperties } from 'react';

/** Блок «Telegram-боты» со ссылками. Сам грузит данные, не блокирует страницу. */
export function BotLinksSection({ style }: { style?: CSSProperties }) {
  const { links, loading } = useBotLinks();
  return (
    <div style={style}>
      <h3 style={{ marginBottom: 12 }}>Telegram-боты</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <BotLinkCard label="Клиентский бот" link={links?.client ?? null} loading={loading} />
        <BotLinkCard label="Менеджерский бот" link={links?.manager ?? null} loading={loading} />
      </div>
    </div>
  );
}

function BotLinkCard({
  label,
  link,
  loading,
}: {
  label: string;
  link: BotLink | null;
  loading: boolean;
}) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{label}</div>
      {loading ? (
        <div style={{ color: '#888' }}>...</div>
      ) : link ? (
        <>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 20, fontWeight: 700, color: '#2563eb', textDecoration: 'none' }}
          >
            @{link.username}
          </a>
          <div style={{ fontSize: 13, color: '#888', marginTop: 6, wordBreak: 'break-all' }}>
            {link.url}
          </div>
        </>
      ) : (
        <div style={{ color: '#888', fontSize: 14 }}>бот ещё не запускался</div>
      )}
    </div>
  );
}
