'use client';

import { type BotLink, useBotLinks } from '@/hooks/use-bot-links';
import { cardSurface } from '@/lib/table-styles';
import type { CSSProperties } from 'react';

/** Блок «Telegram-боты» со ссылками. Сам грузит данные, не блокирует страницу. */
export function BotLinksSection({ style }: { style?: CSSProperties }) {
  const { links, loading } = useBotLinks();
  return (
    <div style={style}>
      <h3 style={{ marginBottom: 12 }}>Telegram-боты</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
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
    <div className="dp-card-hover" style={{ ...cardSurface, padding: 20, minWidth: 0 }}>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
      {loading ? (
        <div style={{ color: 'var(--text-subtle)' }}>...</div>
      ) : link ? (
        <>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--accent)',
              textDecoration: 'none',
              wordBreak: 'break-all',
            }}
          >
            @{link.username}
          </a>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6, wordBreak: 'break-all' }}>
            {link.url}
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text-subtle)', fontSize: 14 }}>бот ещё не запускался</div>
      )}
    </div>
  );
}
