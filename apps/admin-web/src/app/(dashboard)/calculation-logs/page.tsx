'use client';

import Link from 'next/link';
import { useCalculationLogs } from '@/hooks/use-calculation-logs';
import { th, td, btnOutline } from '@/lib/table-styles';
import { fmt } from '@/lib/format';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'createdAt', label: 'Дата' },
  { field: 'itemsCount', label: 'Товаров' },
];

export default function CalculationLogsPage() {
  const {
    logs, total, loading, page, limit, sortBy, sortOrder,
    setPage, toggleSort, refetch,
  } = useCalculationLogs();

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function sortIndicator(field: string) {
    if (sortBy !== field) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Логи расчётов</h1>
        <button onClick={refetch} style={btnOutline}>Обновить</button>
      </div>

      {loading ? <p>Загрузка...</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {sortableColumns.map((col) => (
                  <th key={col.field} style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col.field)}>
                    {col.label}{sortIndicator(col.field)}
                  </th>
                ))}
                <th style={th}>Файл</th>
                <th style={th}>Пользователь</th>
                <th style={{ ...th, textAlign: 'right' }}>Итого</th>
                <th style={{ ...th, textAlign: 'right' }}>Пошлина</th>
                <th style={{ ...th, textAlign: 'right' }}>НДС</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={td}>{new Date(log.createdAt).toLocaleString('ru')}</td>
                  <td style={td}>{log.itemsCount}</td>
                  <td style={td}>
                    {log.documentId ? (
                      <Link href={`/documents/${log.documentId}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                        {log.fileName || '—'}
                      </Link>
                    ) : (
                      log.fileName || '—'
                    )}
                  </td>
                  <td style={td}>
                    {log.telegramUsername ? `@${log.telegramUsername}` : log.telegramUserId || '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {log.resultSummary ? fmt(log.resultSummary.grandTotal) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {log.resultSummary ? fmt(log.resultSummary.totalDuty) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {log.resultSummary ? fmt(log.resultSummary.totalVat) : '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td style={{ ...td, textAlign: 'center', color: '#888' }} colSpan={7}>
                    Логов расчётов пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 14 }}>
            <span style={{ color: '#666' }}>Всего: {total}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} style={btnOutline}>← Пред</button>
              <span>{page} из {totalPages}</span>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages} style={btnOutline}>След →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
