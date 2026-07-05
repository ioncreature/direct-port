'use client';

import { BotLinksSection } from '@/components/bot-links-section';
import { useDocuments } from '@/hooks/use-documents';
import { useTelegramUsers } from '@/hooks/use-telegram-users';
import { useUsers } from '@/hooks/use-users';
import api from '@/lib/api';
import { statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, fmtCost } from '@/lib/format';
import { cardSurface } from '@/lib/table-styles';
import type { DocumentStatus, MonthlyTokenStats } from '@/lib/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const { total: usersTotal, loading: usersLoading } = useUsers();
  const { documents, total: docsTotal, loading: docsLoading } = useDocuments();
  const { total: tgTotal, loading: tgLoading } = useTelegramUsers();
  const [aiCost, setAiCost] = useState<number | null>(null);
  const [leadCost, setLeadCost] = useState<number | null>(null);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<DocumentStatus, number>>>({});

  useEffect(() => {
    api.get<MonthlyTokenStats>('/documents/token-stats/monthly').then(({ data }) => {
      setAiCost(calcAiCostFromMap(data.models));
      // Лиды приходят только в общем разрезе (для super_admin); у admin'а компании — null.
      if (data.leads) setLeadCost(calcAiCostFromMap(data.leads));
    }).catch(() => {});
    api.get<Partial<Record<DocumentStatus, number>>>('/documents/status-counts').then(({ data }) => {
      setStatusCounts(data);
    }).catch(() => {});
  }, []);

  const loading = usersLoading || docsLoading || tgLoading;

  if (loading) return <p>Загрузка...</p>;

  const recentDocs = [...documents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const statusRows = [
    'parsing',
    'pending',
    'processing',
    'processed',
    'processed_with_errors',
    'failed',
  ] as DocumentStatus[];

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Дашборд</h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard label="Пользователи" value={usersTotal} href="/users" />
        <StatCard label="Telegram" value={tgTotal} href="/telegram-users" />
        <StatCard label="Документы" value={docsTotal} href="/documents" />
        <StatCard label="Обработано" value={statusCounts.processed ?? 0} color="var(--success)" />
        <StatCard
          label="Частично"
          value={statusCounts.processed_with_errors ?? 0}
          color="var(--warning)"
        />
        <StatCard label="Сбои" value={statusCounts.failed ?? 0} color="var(--danger)" />
        <StatCard
          label="AI за месяц"
          value={aiCost != null ? fmtCost(aiCost) : '...'}
          href="/ai-costs"
          color="var(--violet)"
        />
        {leadCost != null && (
          <StatCard
            label="Поиск лидов за месяц"
            value={fmtCost(leadCost)}
            href="/ai-costs"
            color="var(--violet)"
          />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h3 style={{ marginBottom: 12 }}>Статусы документов</h3>
          <div style={cardStyle}>
            {statusRows.map((status, i) => (
              <div
                key={status}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom:
                    i < statusRows.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: statusColors[status],
                    }}
                  />
                  <span style={{ color: 'var(--text)' }}>{statusLabels[status]}</span>
                </span>
                <strong style={{ color: 'var(--text)' }}>{statusCounts[status] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 12 }}>Последние документы</h3>
          <div style={cardStyle}>
            {recentDocs.length === 0 && (
              <p style={{ color: 'var(--text-subtle)' }}>Документов пока нет</p>
            )}
            {recentDocs.map((doc, i) => (
              <div
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '9px 0',
                  borderBottom:
                    i < recentDocs.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.originalFileName}
                </span>
                <span
                  style={{
                    color: statusColors[doc.status],
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusLabels[doc.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BotLinksSection style={{ marginTop: 32 }} />
    </div>
  );
}

const cardStyle: React.CSSProperties = { ...cardSurface, padding: '8px 18px' };

function StatCard({
  label,
  value,
  href,
  color,
}: {
  label: string;
  value: number | string;
  href?: string;
  color?: string;
}) {
  const content = (
    <div
      className={href ? 'dp-card-hover' : undefined}
      style={{ ...cardSurface, padding: 20, height: '100%' }}
    >
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: color || 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginTop: 6 }}>
        {label}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
        {content}
      </Link>
    );
  }
  return content;
}
