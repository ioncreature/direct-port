'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useDocument } from '@/hooks/use-document';
import { statusLabels, statusColors, downloadDocument } from '@/lib/documents';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { DocumentResultRow } from '@/lib/types';

const columnMappingLabels: Record<string, string> = {
  description: 'Описание',
  price: 'Цена',
  weight: 'Вес',
  quantity: 'Количество',
};

function fmt(n: number) {
  return n.toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { document: doc, loading, error } = useDocument(id);

  if (loading) return <p>Загрузка...</p>;
  if (error || !doc) return <p style={{ color: '#dc2626' }}>{error || 'Документ не найден'}</p>;

  const rows = doc.resultData ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.totalPrice += r.totalPrice;
      acc.dutyAmount += r.dutyAmount;
      acc.vatAmount += r.vatAmount;
      acc.exciseAmount += r.exciseAmount;
      acc.logisticsCommission += r.logisticsCommission;
      acc.totalCost += r.totalCost;
      return acc;
    },
    { totalPrice: 0, dutyAmount: 0, vatAmount: 0, exciseAmount: 0, logisticsCommission: 0, totalCost: 0 },
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Link href="/documents" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>
          &larr; Назад к документам
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>{doc.originalFileName}</h1>
        {doc.status === 'processed' && (
          <button
            onClick={() => downloadDocument(doc.id, doc.originalFileName)}
            style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Скачать Excel
          </button>
        )}
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <InfoCard label="Статус" value={statusLabels[doc.status]} color={statusColors[doc.status]} />
        <InfoCard label="Строк" value={String(doc.rowCount)} />
        <InfoCard label="Пользователь" value={getDocumentUploaderName(doc)} />
        <InfoCard label="Создан" value={new Date(doc.createdAt).toLocaleString('ru')} />
        <InfoCard label="Обновлён" value={new Date(doc.updatedAt).toLocaleString('ru')} />
      </div>

      {doc.errorMessage && (
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 24 }}>
          <strong style={{ color: '#dc2626' }}>Ошибка:</strong>{' '}
          <span style={{ color: '#991b1b' }}>{doc.errorMessage}</span>
        </div>
      )}

      {/* Column mapping */}
      {doc.columnMapping && Object.keys(doc.columnMapping).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Маппинг колонок</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(doc.columnMapping).map(([key, col]) => (
              <span key={key} style={{ fontSize: 14, color: '#555' }}>
                {columnMappingLabels[key] || key}: <strong>колонка {col}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Result data table */}
      {rows.length > 0 && (
        <>
          <h3 style={{ marginBottom: 12 }}>Результаты расчёта</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={{ ...th, minWidth: 180 }}>Наименование</th>
                  <th style={thR}>Кол-во</th>
                  <th style={thR}>Цена</th>
                  <th style={thR}>Вес</th>
                  <th style={th}>Код ТН ВЭД</th>
                  <th style={thR}>Сумма</th>
                  <th style={thR}>Пошлина</th>
                  <th style={thR}>НДС</th>
                  <th style={thR}>Акциз</th>
                  <th style={thR}>Доставка</th>
                  <th style={thR}>Итого</th>
                  <th style={th}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <ResultRow key={i} row={row} index={i + 1} />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={td} colSpan={6}>Итого</td>
                  <td style={tdR}>{fmt(totals.totalPrice)}</td>
                  <td style={tdR}>{fmt(totals.dutyAmount)}</td>
                  <td style={tdR}>{fmt(totals.vatAmount)}</td>
                  <td style={tdR}>{fmt(totals.exciseAmount)}</td>
                  <td style={tdR}>{fmt(totals.logisticsCommission)}</td>
                  <td style={tdR}>{fmt(totals.totalCost)}</td>
                  <td style={td}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {doc.status === 'processed' && rows.length === 0 && (
        <p style={{ color: '#888' }}>Нет данных результата</p>
      )}
    </div>
  );
}

function InfoCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: color || '#000' }}>{value}</div>
    </div>
  );
}

function ResultRow({ row, index }: { row: DocumentResultRow; index: number }) {
  const statusColor = row.verificationStatus === 'exact' ? '#16a34a' : '#ca8a04';
  const statusLabel = row.verificationStatus === 'exact' ? 'Точный' : 'На проверку';

  return (
    <tr>
      <td style={td}>{index}</td>
      <td style={{ ...td, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.description}>
        {row.description}
      </td>
      <td style={tdR}>{row.quantity}</td>
      <td style={tdR}>{fmt(row.price)}</td>
      <td style={tdR}>{fmt(row.weight)}</td>
      <td style={td} title={row.tnVedDescription}>
        <code style={{ fontSize: 12 }}>{row.tnVedCode}</code>
      </td>
      <td style={tdR}>{fmt(row.totalPrice)}</td>
      <td style={tdR}>{fmt(row.dutyAmount)}</td>
      <td style={tdR}>{fmt(row.vatAmount)}</td>
      <td style={tdR}>{row.exciseAmount > 0 ? fmt(row.exciseAmount) : '—'}</td>
      <td style={tdR}>{fmt(row.logisticsCommission)}</td>
      <td style={tdR}>{fmt(row.totalCost)}</td>
      <td style={td}>
        <span style={{ color: statusColor, fontSize: 12, fontWeight: 500 }}>{statusLabel}</span>
      </td>
    </tr>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd', whiteSpace: 'nowrap' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
