'use client';

import { useDocuments } from '@/hooks/use-documents';
import type { DocumentStatus } from '@/lib/types';

const statusLabels: Record<DocumentStatus, string> = {
  pending: 'Ожидает',
  processing: 'Обработка...',
  processed: 'Обработан',
  failed: 'Ошибка',
};

const statusColors: Record<DocumentStatus, string> = {
  pending: '#888',
  processing: '#2563eb',
  processed: '#16a34a',
  failed: '#dc2626',
};

function getTelegramName(doc: { telegramUser: { username: string | null; firstName: string | null; lastName: string | null } }) {
  const u = doc.telegramUser;
  if (u.username) return `@${u.username}`;
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
}

export default function DocumentsPage() {
  const { documents, loading, refetch, downloadDocument } = useDocuments();

  if (loading) return <p>Загрузка...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Документы</h1>
        <button
          onClick={refetch}
          style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: 4, border: '1px solid #ddd' }}
        >
          Обновить
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Пользователь</th>
            <th style={th}>Файл</th>
            <th style={th}>Статус</th>
            <th style={th}>Строк</th>
            <th style={th}>Дата</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id}>
              <td style={td}>{getTelegramName(doc)}</td>
              <td style={td}>{doc.originalFileName}</td>
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
              <td style={{ ...td, textAlign: 'center', color: '#888' }} colSpan={6}>
                Документов пока нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #ddd' };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #eee' };
