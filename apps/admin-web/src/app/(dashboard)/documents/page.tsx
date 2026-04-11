'use client';

import { useDocuments } from '@/hooks/use-documents';
import { statusColors, statusLabels } from '@/lib/documents';
import { fmtDateTime } from '@/lib/format';
import { btnOutline, td, th } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { DocumentStatus } from '@/lib/types';
import Link from 'next/link';

const statuses: { value: DocumentStatus | ''; label: string }[] = [
  { value: '', label: 'Все' },
  ...Object.entries(statusLabels).map(([value, label]) => ({
    value: value as DocumentStatus,
    label,
  })),
];

const sortableColumns: { field: string; label: string }[] = [
  { field: 'originalFileName', label: 'Файл' },
  { field: 'status', label: 'Статус' },
  { field: 'rowCount', label: 'Строк' },
  { field: 'createdAt', label: 'Дата' },
];

export default function DocumentsPage() {
  const {
    documents,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    status,
    setPage,
    toggleSort,
    filterByStatus,
    refetch,
    downloadDocument,
  } = useDocuments();

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function sortIndicator(field: string) {
    if (sortBy !== field) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h1>Документы</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/documents/upload"
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 4,
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            Загрузить
          </Link>
          <button onClick={refetch} style={btnOutline}>
            Обновить
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {statuses.map((s) => (
          <button
            key={s.value}
            onClick={() => filterByStatus(s.value)}
            style={{
              padding: '4px 12px',
              borderRadius: 16,
              cursor: 'pointer',
              fontSize: 13,
              border: '1px solid #ddd',
              background: status === s.value ? '#2563eb' : '#fff',
              color: status === s.value ? '#fff' : '#333',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Пользователь</th>
                {sortableColumns.map((col) => (
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
                  <td style={td}>{getDocumentUploaderName(doc)}</td>
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
                  <td style={td}>{fmtDateTime(doc.createdAt)}</td>
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
                    Документов не найдено
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
