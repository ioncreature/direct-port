'use client';

import { InfoCard } from '@/components/info-card';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useDocuments } from '@/hooks/use-documents';
import { useTelegramUser } from '@/hooks/use-telegram-user';
import { statusColors, statusLabels } from '@/lib/documents';
import { fmtDate, fmtDateTimeLocale } from '@/lib/format';
import { tdEmpty, td, th } from '@/lib/table-styles';
import { getTelegramName } from '@/lib/telegram';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { MessagesPanel } from './messages-panel';
import { TabsNav } from '@/components/tabs-nav';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'originalFileName', label: 'Файл' },
  { field: 'status', label: 'Статус' },
  { field: 'rowCount', label: 'Строк' },
  { field: 'createdAt', label: 'Дата' },
];

export default function TelegramUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<'documents' | 'messages'>('documents');
  const { user, loading: userLoading, error } = useTelegramUser(id);
  const {
    documents,
    total,
    loading: docsLoading,
    page,
    limit,
    sortBy,
    sortOrder,
    setPage,
    toggleSort,
    downloadDocument,
  } = useDocuments({ telegramUserId: id });

  if (userLoading) return <p>Загрузка...</p>;
  if (error || !user)
    return <p style={{ color: '#dc2626' }}>{error || 'Пользователь не найден'}</p>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/telegram-users"
          style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 14 }}
        >
          &larr; Назад к Telegram-пользователям
        </Link>
      </div>

      <h1>{getTelegramName(user)}</h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 32,
        }}
      >
        <InfoCard label="Telegram ID" value={user.telegramId} />
        <InfoCard label="Username" value={user.username ? `@${user.username}` : '—'} />
        <InfoCard
          label="Имя"
          value={[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
        />
        <InfoCard label="Документов" value={String(user.documentCount ?? 0)} />
        <InfoCard label="Регистрация" value={fmtDateTimeLocale(user.createdAt)} />
      </div>

      <TabsNav
        tabs={['documents', 'messages'] as const}
        active={activeTab}
        onChange={setActiveTab}
        labels={{ documents: 'Документы', messages: 'Переписка' }}
      />

      {activeTab === 'messages' ? (
        <MessagesPanel clientId={id} />
      ) : docsLoading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {sortableColumns.map((col) => (
                  <SortableTh
                    key={col.field}
                    field={col.field}
                    label={col.label}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                  />
                ))}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={td}>
                    <Link
                      href={`/documents/${doc.id}`}
                      style={{ color: 'var(--accent)', textDecoration: 'none' }}
                    >
                      {doc.originalFileName}
                    </Link>
                  </td>
                  <td style={td}>
                    <span style={{ color: statusColors[doc.status], fontWeight: 500 }}>
                      {statusLabels[doc.status]}
                    </span>
                  </td>
                  <td style={td}>{doc.rowCount}</td>
                  <td style={td}>{fmtDate(doc.createdAt)}</td>
                  <td style={td}>
                    <button
                      onClick={() => downloadDocument(doc.id)}
                      disabled={doc.status !== 'processed'}
                      style={{
                        cursor: doc.status === 'processed' ? 'pointer' : 'not-allowed',
                        opacity: doc.status === 'processed' ? 1 : 0.4,
                        border: 'none',
                        background: 'none',
                        color: 'var(--accent)',
                        textDecoration: 'underline',
                      }}
                    >
                      Скачать
                    </button>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={5}>
                    Документов нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pager page={page} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
