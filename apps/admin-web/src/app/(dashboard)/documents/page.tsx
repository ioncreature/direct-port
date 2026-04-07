'use client';

import Link from 'next/link';
import { useDocuments } from '@/hooks/use-documents';
import { statusLabels, statusColors } from '@/lib/documents';
import { getTelegramName } from '@/lib/telegram';

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
              <td style={td}>{getTelegramName(doc.telegramUser)}</td>
              <td style={td}>
                <Link href={`/documents/${doc.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
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
