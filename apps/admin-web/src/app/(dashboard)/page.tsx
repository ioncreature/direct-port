'use client';

import Link from 'next/link';
import { useUsers } from '@/hooks/use-users';
import { useDocuments } from '@/hooks/use-documents';
import { useTelegramUsers } from '@/hooks/use-telegram-users';
import { statusLabels, statusColors } from '@/lib/documents';
import type { DocumentStatus } from '@/lib/types';

export default function DashboardPage() {
  const { users, loading: usersLoading } = useUsers();
  const { documents, loading: docsLoading } = useDocuments();
  const { telegramUsers, loading: tgLoading } = useTelegramUsers();

  const loading = usersLoading || docsLoading || tgLoading;

  if (loading) return <p>Загрузка...</p>;

  const statusCounts = documents.reduce(
    (acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const recentDocs = [...documents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Дашборд</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard label="Пользователи" value={users.length} href="/users" />
        <StatCard label="Telegram" value={telegramUsers.length} href="/telegram-users" />
        <StatCard label="Документы" value={documents.length} href="/documents" />
        <StatCard label="Обработано" value={statusCounts['processed'] || 0} color="#16a34a" />
        <StatCard label="Ошибки" value={statusCounts['failed'] || 0} color="#dc2626" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h3 style={{ marginBottom: 12 }}>Статусы документов</h3>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            {(['pending', 'processing', 'processed', 'failed'] as DocumentStatus[]).map((status) => (
              <div key={status} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ color: statusColors[status] }}>{statusLabels[status]}</span>
                <strong>{statusCounts[status] || 0}</strong>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 12 }}>Последние документы</h3>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            {recentDocs.length === 0 && <p style={{ color: '#888' }}>Документов пока нет</p>}
            {recentDocs.map((doc) => (
              <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {doc.originalFileName}
                </span>
                <span style={{ color: statusColors[doc.status], fontSize: 14 }}>
                  {statusLabels[doc.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, href, color }: { label: string; value: number; href?: string; color?: string }) {
  const content = (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: color || '#000' }}>{value}</div>
      <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{label}</div>
    </div>
  );

  if (href) {
    return <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{content}</Link>;
  }
  return content;
}
