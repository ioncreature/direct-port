'use client';

import { InfoCard } from '@/components/info-card';
import { useDocuments } from '@/hooks/use-documents';
import { useTelegramUser } from '@/hooks/use-telegram-user';
import { statusColors, statusLabels } from '@/lib/documents';
import { btnOutline, td, th } from '@/lib/table-styles';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function TelegramUserDetailPage() {
  const { id } = useParams<{ id: string }>();
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

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function sortIndicator(field: string) {
    if (sortBy !== field) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  }

  if (userLoading) return <p>Загрузка...</p>;
  if (error || !user)
    return <p style={{ color: '#dc2626' }}>{error || 'Пользователь не найден'}</p>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/telegram-users"
          style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}
        >
          &larr; Назад к Telegram-пользователям
        </Link>
      </div>

      <h1>
        {user.username
          ? `@${user.username}`
          : [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Telegram-пользователь'}
      </h1>

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
        <InfoCard label="Регистрация" value={new Date(user.createdAt).toLocaleString('ru')} />
      </div>

      <h2>Документы</h2>

      {docsLoading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  { field: 'originalFileName', label: 'Файл' },
                  { field: 'status', label: 'Статус' },
                  { field: 'rowCount', label: 'Строк' },
                  { field: 'createdAt', label: 'Дата' },
                ].map((col) => (
                  <th
                    key={col.field}
                    style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleSort(col.field)}
                  >
                    {col.label}
                    {sortIndicator(col.field)}
                  </th>
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
                      style={{ color: '#2563eb', textDecoration: 'none' }}
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
                  <td style={td}>{new Date(doc.createdAt).toLocaleDateString('ru')}</td>
                  <td style={td}>
                    <button
                      onClick={() => downloadDocument(doc.id, doc.originalFileName)}
                      disabled={doc.status !== 'processed'}
                      style={{
                        cursor: doc.status === 'processed' ? 'pointer' : 'not-allowed',
                        opacity: doc.status === 'processed' ? 1 : 0.4,
                        border: 'none',
                        background: 'none',
                        color: '#2563eb',
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
                  <td style={{ ...td, textAlign: 'center', color: '#888' }} colSpan={5}>
                    Документов нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 16,
              fontSize: 14,
            }}
          >
            <span style={{ color: '#666' }}>Всего: {total}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} style={btnOutline}>
                ← Пред
              </button>
              <span>
                {page} из {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                style={btnOutline}
              >
                След →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
