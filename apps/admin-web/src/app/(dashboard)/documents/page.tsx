'use client';

import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useDocuments } from '@/hooks/use-documents';
import { statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromStages, fmtCost, fmtDateTime } from '@/lib/format';
import { btnLink, btnOutline, td, tdEmpty, tdR, th, thR } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { DocumentStatus } from '@/lib/types';
import Link from 'next/link';
import { useState } from 'react';

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
    reprocessDocument,
  } = useDocuments();

  const [reprocessingIds, setReprocessingIds] = useState<Set<string>>(new Set());

  const handleReprocess = async (id: string) => {
    setReprocessingIds((prev) => new Set(prev).add(id));
    try {
      await reprocessDocument(id);
    } finally {
      setReprocessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

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
                  <SortableTh
                    key={col.field}
                    field={col.field}
                    label={col.label}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                  />
                ))}
                <th style={thR}>Стоимость AI</th>
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
                    <span
                      style={{ color: statusColors[doc.status], fontWeight: 500 }}
                      title={doc.rejectionReasons?.join('; ') || doc.errorMessage || undefined}
                    >
                      {statusLabels[doc.status]}
                    </span>
                  </td>
                  <td style={td}>{doc.rowCount}</td>
                  <td style={td}>{fmtDateTime(doc.createdAt)}</td>
                  <td style={tdR}>
                    {doc.tokenUsage ? fmtCost(calcAiCostFromStages(doc.tokenUsage)) : '—'}
                  </td>
                  <td style={td}>
                    {(doc.status === 'failed' || doc.status === 'requires_review' || doc.status === 'processed_with_errors') && (
                      <button
                        onClick={() => handleReprocess(doc.id)}
                        disabled={reprocessingIds.has(doc.id)}
                        style={{ ...btnLink, color: '#ca8a04' }}
                      >
                        {reprocessingIds.has(doc.id) ? 'Отправка...' : 'Переобработать'}
                      </button>
                    )}
                    {doc.status === 'processed' && (
                      <button
                        onClick={() => downloadDocument(doc.id)}
                        style={{ ...btnLink, color: '#2563eb' }}
                      >
                        Скачать
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={7}>
                    Документов не найдено
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
