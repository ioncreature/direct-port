'use client';

import { type BotLink, useBotLinks } from '@/hooks/use-bot-links';
import { cardSurface } from '@/lib/table-styles';
import type { CSSProperties } from 'react';

/**
 * Блок «Telegram-боты»: реальные боты компании. Если у компании есть собственный бот — показывает
 * его, иначе общий платформенный (с пометкой). companyId задаётся только super_admin (выбор компании
 * на дашборде); для admin/customs не передаётся — бэкенд скоупит по их компании.
 */
export function BotLinksSection({
  companyId,
  style,
}: {
  companyId?: string;
  style?: CSSProperties;
}) {
  const { links, loading } = useBotLinks(companyId);
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
          <OwnBadge own={link.own} />
        </>
      ) : (
        <div style={{ color: 'var(--text-subtle)', fontSize: 14 }}>бот ещё не запускался</div>
      )}
    </div>
  );
}

/** Собственный бот компании или общий платформенный (когда у компании своего нет). */
function OwnBadge({ own }: { own: boolean }) {
  return (
    <div
      style={{
        display: 'inline-block',
        marginTop: 8,
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 12,
        color: own ? 'var(--success)' : 'var(--text-muted)',
        background: 'var(--bg-subtle)',
      }}
    >
      {own ? 'бот компании' : 'общий бот'}
    </div>
  );
}
