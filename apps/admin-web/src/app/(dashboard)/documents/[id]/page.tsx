'use client';

import { InfoCard } from '@/components/info-card';
import { useDocument } from '@/hooks/use-document';
import { downloadDocument, statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, calcAiCostFromStages, fmt, fmtCost, fmtTokens, modelLabel, stageLabel } from '@/lib/format';
import { btnOutline } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { CalculationStatus, DocumentResultRow, ParsedDataRow, ProductNoteSeverity } from '@/lib/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

const columnMappingLabels: Record<string, string> = {
  description: 'Описание',
  price: 'Цена',
  weight: 'Вес',
  quantity: 'Количество',
};

const calcStatusConfig: Record<CalculationStatus, { label: string; color: string; bg: string }> = {
  exact: { label: 'Точное', color: '#16a34a', bg: '#dcfce7' },
  partial: { label: 'Есть замечания', color: '#ca8a04', bg: '#fef9c3' },
  needs_info: { label: 'Требует уточнения', color: '#c2410c', bg: '#fed7aa' },
  error: { label: 'Ошибка', color: '#dc2626', bg: '#fee2e2' },
};

const noteSeverityConfig: Record<ProductNoteSeverity, { icon: string; color: string }> = {
  blocker: { icon: '!!', color: '#dc2626' },
  warning: { icon: '!', color: '#ca8a04' },
  info: { icon: 'i', color: '#6b7280' },
};

const severityOrder: ProductNoteSeverity[] = ['blocker', 'warning', 'info'];

function resolveStatus(row: DocumentResultRow): CalculationStatus {
  if (row.calculationStatus) return row.calculationStatus;
  return row.verificationStatus === 'exact' ? 'exact' : 'partial';
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { document: doc, loading, error, reprocess, saveParsedData, reject } = useDocument(id);

  const [reprocessing, setReprocessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const toggleRow = useCallback(
    (i: number) => setExpandedRow((prev) => (prev === i ? null : i)),
    [],
  );
  const [editableRows, setEditableRows] = useState<ParsedDataRow[]>([]);
  const [editableCurrency, setEditableCurrency] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isReview = doc?.status === 'requires_review';

  useEffect(() => {
    if (doc?.parsedData) {
      setEditableRows(
        doc.parsedData.map((r) => ({
          description: String(r.description ?? ''),
          quantity: Number(r.quantity) || 0,
          price: Number(r.price) || 0,
          weight: Number(r.weight) || 0,
        })),
      );
      setEditableCurrency(doc.currency || '');
    }
  }, [doc?.parsedData, doc?.currency]);

  const rows = doc?.resultData ?? [];
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.totalPrice += r.totalPrice;
          acc.dutyAmount += r.dutyAmount;
          acc.vatAmount += r.vatAmount;
          acc.exciseAmount += r.exciseAmount;
          acc.logisticsCommission += r.logisticsCommission;
          acc.totalCost += r.totalCost;
          return acc;
        },
        {
          totalPrice: 0,
          dutyAmount: 0,
          vatAmount: 0,
          exciseAmount: 0,
          logisticsCommission: 0,
          totalCost: 0,
        },
      ),
    [rows],
  );

  if (loading) return <p>Загрузка...</p>;
  if (error || !doc) return <p style={{ color: '#dc2626' }}>{error || 'Документ не найден'}</p>;

  const updateRow = (index: number, field: keyof ParsedDataRow, value: string | number) => {
    setEditableRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const deleteRow = (index: number) => {
    setEditableRows((prev) => prev.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setEditableRows((prev) => [...prev, { description: '', quantity: 1, price: 0, weight: 0 }]);
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await saveParsedData(editableRows, editableCurrency || undefined);
      await reprocess();
    } catch {
      // saveParsedData throws on failure to skip reprocess
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try {
      await reject(rejectReason.trim());
      setShowRejectForm(false);
      setRejectReason('');
    } finally {
      setRejecting(false);
    }
  };

  const parsedRows = doc.parsedData ?? [];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Link href="/documents" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>
          &larr; Назад к документам
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>{doc.originalFileName}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {isReview && (
            <>
              <button
                onClick={handleApprove}
                disabled={approving || editableRows.length === 0}
                style={{
                  padding: '8px 16px',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {approving ? 'Сохранение...' : 'Подтвердить и обработать'}
              </button>
              <button
                onClick={() => setShowRejectForm(!showRejectForm)}
                disabled={rejecting}
                style={{
                  padding: '8px 16px',
                  background: '#fff',
                  color: '#dc2626',
                  border: '1px solid #dc2626',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Отклонить
              </button>
            </>
          )}
          {doc.status === 'failed' && (
            <button
              onClick={async () => {
                setReprocessing(true);
                try {
                  await reprocess();
                } finally {
                  setReprocessing(false);
                }
              }}
              disabled={reprocessing}
              style={{
                padding: '8px 16px',
                background: '#ca8a04',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {reprocessing ? 'Отправка...' : 'Переобработать'}
            </button>
          )}
          {doc.status === 'processed' && (
            <button
              onClick={() => downloadDocument(doc.id, doc.originalFileName)}
              style={{
                padding: '8px 16px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Скачать Excel
            </button>
          )}
        </div>
      </div>

      {/* Reject form */}
      {showRejectForm && (
        <div
          style={{
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            marginBottom: 24,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <label style={{ fontSize: 14, whiteSpace: 'nowrap' }}>Причина:</label>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Укажите причину отклонения"
            style={{
              flex: 1,
              padding: '6px 10px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleReject()}
          />
          <button
            onClick={handleReject}
            disabled={rejecting || !rejectReason.trim()}
            style={{
              padding: '6px 14px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            {rejecting ? 'Отклонение...' : 'Подтвердить отклонение'}
          </button>
          <button
            onClick={() => {
              setShowRejectForm(false);
              setRejectReason('');
            }}
            style={{
              padding: '6px 14px',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Отмена
          </button>
        </div>
      )}

      {/* Info cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <InfoCard
          label="Статус"
          value={statusLabels[doc.status]}
          color={statusColors[doc.status]}
        />
        <InfoCard label="Строк" value={String(doc.rowCount)} />
        {doc.currency && <InfoCard label="Валюта" value={doc.currency} />}
        <InfoCard label="Пользователь" value={getDocumentUploaderName(doc)} />
        <InfoCard label="Создан" value={new Date(doc.createdAt).toLocaleString('ru')} />
        <InfoCard label="Обновлён" value={new Date(doc.updatedAt).toLocaleString('ru')} />
      </div>

      {/* Token usage */}
      {doc.tokenUsage && Object.keys(doc.tokenUsage).length > 0 && (
        <div style={{ marginBottom: 24, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>AI-расходы</h3>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{fmtCost(calcAiCostFromStages(doc.tokenUsage))}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(doc.tokenUsage).map(([stage, models]) => {
              const stageCost = calcAiCostFromMap(models);
              return (
                <div key={stage} style={{ flex: '1 1 180px', padding: 12, background: '#f9f9f9', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{stageLabel(stage)}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtCost(stageCost)}</div>
                  {Object.entries(models).map(([model, usage]) => (
                    <div key={model} style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      {modelLabel(model)}: {fmtTokens(usage.inputTokens)} in / {fmtTokens(usage.outputTokens)} out
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {doc.errorMessage && (
        <div
          style={{
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
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

      {/* Parsed data — editable for requires_review, read-only for others */}
      {isReview && editableRows.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0 }}>Исходные данные (проверка)</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: '#555' }}>
                Валюта:
                <input
                  type="text"
                  value={editableCurrency}
                  onChange={(e) => setEditableCurrency(e.target.value.toUpperCase())}
                  style={{
                    marginLeft: 6,
                    width: 60,
                    padding: '4px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 3,
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                />
              </label>
              <button onClick={addRow} style={btnOutline}>
                + Добавить строку
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={{ ...th, minWidth: 250 }}>Наименование</th>
                  <th style={{ ...thR, minWidth: 80 }}>Кол-во</th>
                  <th style={{ ...thR, minWidth: 100 }}>Цена</th>
                  <th style={{ ...thR, minWidth: 90 }}>Вес (кг)</th>
                  <th style={{ ...th, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {editableRows.map((row, i) => (
                  <tr key={i}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => updateRow(i, 'description', e.target.value)}
                        style={inputText}
                      />
                    </td>
                    <td style={tdR}>
                      <input
                        type="number"
                        step="any"
                        value={row.quantity}
                        onChange={(e) => updateRow(i, 'quantity', parseFloat(e.target.value) || 0)}
                        style={inputNumber}
                      />
                    </td>
                    <td style={tdR}>
                      <input
                        type="number"
                        step="any"
                        value={row.price}
                        onChange={(e) => updateRow(i, 'price', parseFloat(e.target.value) || 0)}
                        style={inputNumber}
                      />
                    </td>
                    <td style={tdR}>
                      <input
                        type="number"
                        step="any"
                        value={row.weight}
                        onChange={(e) => updateRow(i, 'weight', parseFloat(e.target.value) || 0)}
                        style={inputNumber}
                      />
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => deleteRow(i)}
                        title="Удалить строку"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#dc2626',
                          cursor: 'pointer',
                          fontSize: 16,
                          padding: '0 4px',
                        }}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Parsed data read-only for non-review statuses */}
      {!isReview && parsedRows.length > 0 && !rows.length && (
        <>
          <h3 style={{ marginBottom: 12 }}>Исходные данные</h3>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={{ ...th, minWidth: 250 }}>Наименование</th>
                  <th style={thR}>Кол-во</th>
                  <th style={thR}>Цена</th>
                  <th style={thR}>Вес (кг)</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr key={i}>
                    <td style={td}>{i + 1}</td>
                    <td
                      style={{
                        ...td,
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={String(row.description)}
                    >
                      {String(row.description)}
                    </td>
                    <td style={tdR}>{Number(row.quantity)}</td>
                    <td style={tdR}>{fmt(Number(row.price))}</td>
                    <td style={tdR}>{fmt(Number(row.weight))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Result data table */}
      {rows.length > 0 && (
        <>
          <h3 style={{ marginBottom: 12 }}>Результаты расчёта</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 40 }}>#</th>
                  <th style={{ ...th, width: 50 }}></th>
                  <th style={{ ...th, minWidth: 200 }}>Наименование</th>
                  <th style={{ ...th, minWidth: 100 }}>Код ТН ВЭД</th>
                  <th style={{ ...thR, minWidth: 90 }}>Сумма</th>
                  <th style={{ ...thR, minWidth: 90 }}>Итого</th>
                  <th style={{ ...th, width: 150, textAlign: 'center' }}>Статус</th>
                  <th style={{ ...th, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <ResultRow
                    key={i}
                    row={row}
                    index={i}
                    isExpanded={expandedRow === i}
                    onToggle={toggleRow}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={td} colSpan={4}>Итого</td>
                  <td style={tdR}>{fmt(totals.totalPrice)}</td>
                  <td style={tdR}>{fmt(totals.totalCost)}</td>
                  <td style={td} colSpan={2}></td>
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

const ResultRow = memo(function ResultRow({
  row,
  index,
  isExpanded,
  onToggle,
}: {
  row: DocumentResultRow;
  index: number;
  isExpanded: boolean;
  onToggle: (index: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const status = resolveStatus(row);
  const statusCfg = calcStatusConfig[status];

  return (
    <>
      <tr
        onClick={() => onToggle(index)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer', background: hovered ? '#fafafa' : 'transparent' }}
      >
        <td style={td}>{index + 1}</td>
        <td style={td}>
          <ImagePlaceholder size={40} />
        </td>
        <td style={tdDesc} title={row.description}>
          {row.description}
        </td>
        <td style={td} title={row.tnVedDescription}>
          <code style={{ fontSize: 12 }}>{row.tnVedCode}</code>
        </td>
        <td style={tdR}>{fmt(row.totalPrice)}</td>
        <td style={tdR}>{fmt(row.totalCost)}</td>
        <td style={tdCenter}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 500,
              color: statusCfg.color,
              background: statusCfg.bg,
            }}
          >
            {statusCfg.label}
          </span>
        </td>
        <td style={tdCenter}>
          <span
            style={{
              display: 'inline-block',
              transition: 'transform 0.15s ease',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              fontSize: 14,
              color: '#9ca3af',
            }}
          >
            &#9662;
          </span>
        </td>
      </tr>

      {isExpanded && <ResultDetail row={row} />}
    </>
  );
});

function ResultDetail({ row }: { row: DocumentResultRow }) {
  const notes = row.notes ?? [];
  const sortedNotes = [...notes].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid #eee' }}>
        <div
          style={{
            display: 'flex',
            gap: 24,
            padding: '16px 12px',
            background: '#fafafa',
          }}
        >
          {/* Left: image + basic info */}
          <div style={{ flex: '0 0 200px' }}>
            <ImagePlaceholder size={120} label="Нет фото" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <DetailField label="Цена за ед." value={fmt(row.price)} />
              <DetailField label="Количество" value={String(row.quantity)} />
              <DetailField label="Вес" value={`${fmt(row.weight)} кг`} />
              {row.tnVedDescription && (
                <DetailField label="Описание ТН ВЭД" value={row.tnVedDescription} />
              )}
            </div>
          </div>

          {/* Center: calculation breakdown */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>
              Расчёт
            </div>
            <CalcLine label="Сумма товара" value={fmt(row.totalPrice)} />
            <CalcLine
              label="Пошлина"
              value={fmt(row.dutyAmount)}
              note={row.dutyAmountIsEstimate ? 'оценочная' : undefined}
            />
            <CalcLine label="НДС" value={fmt(row.vatAmount)} />
            <CalcLine
              label="Акциз"
              value={row.exciseAmount > 0 ? fmt(row.exciseAmount) : '—'}
            />
            <CalcLine label="Комиссия доставки" value={fmt(row.logisticsCommission)} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 0 0',
                marginTop: 4,
                borderTop: '1px solid #ddd',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <span>Итого</span>
              <span>{fmt(row.totalCost)}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              Ставка пошлины: {row.dutyRate}% &middot; НДС: {row.vatRate}%
              {row.exciseRate > 0 && <> &middot; Акциз: {row.exciseRate}%</>}
            </div>
          </div>

          {/* Right: notes + formula */}
          <div style={{ flex: 1, minWidth: 200 }}>
            {row.dutyFormula && (
              <div
                style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#c2410c', marginBottom: 4 }}>
                  Формула пошлины
                </div>
                <div style={{ fontSize: 13, fontStyle: 'italic', color: '#9a3412' }}>
                  {row.dutyFormula}
                </div>
              </div>
            )}
            {sortedNotes.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>
                  Замечания
                </div>
                {sortedNotes.map((note, ni) => {
                  const cfg = noteSeverityConfig[note.severity];
                  return (
                    <div
                      key={ni}
                      style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 13 }}
                    >
                      <span style={{ color: cfg.color, fontWeight: 600, flexShrink: 0 }}>
                        {cfg.icon}
                      </span>
                      <span
                        style={{
                          color: note.severity === 'info' ? '#555' : cfg.color,
                        }}
                      >
                        {note.message}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              !row.dutyFormula && (
                <div style={{ fontSize: 13, color: '#888' }}>Нет замечаний</div>
              )
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ImagePlaceholder({ size, label = 'img' }: { size: number; label?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: '#f3f4f6',
        borderRadius: size > 60 ? 6 : 4,
        border: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af',
        fontSize: size > 60 ? 13 : 11,
      }}
    >
      {label}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function CalcLine({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 0',
        fontSize: 13,
      }}
    >
      <span style={{ color: '#555' }}>
        {label}
        {note && (
          <span style={{ fontSize: 11, color: '#c2410c', marginLeft: 4 }}>({note})</span>
        )}
      </span>
      <span>{value}</span>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '2px solid #ddd',
  whiteSpace: 'nowrap',
};
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
const tdCenter: React.CSSProperties = { ...td, textAlign: 'center' };
const tdDesc: React.CSSProperties = {
  ...td,
  maxWidth: 300,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const inputText: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  border: '1px solid #ddd',
  borderRadius: 3,
  fontSize: 13,
  boxSizing: 'border-box',
};
const inputNumber: React.CSSProperties = {
  width: 90,
  padding: '4px 8px',
  border: '1px solid #ddd',
  borderRadius: 3,
  fontSize: 13,
  textAlign: 'right',
};
