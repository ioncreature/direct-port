'use client';

import { InfoCard } from '@/components/info-card';
import { useCalculationHistory } from '@/hooks/use-calculation-history';
import { useCountries } from '@/hooks/use-countries';
import { useDocument } from '@/hooks/use-document';
import { countryOriginSourceLabels, downloadDocument, statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, calcAiCostFromStages, fmt, fmtCost, fmtTokens, modelLabel, stageLabel } from '@/lib/format';
import { btnOutline } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { CalculationStatus, DocumentResultRow, DocumentStatus, ParsedDataRow, ProductNoteSeverity } from '@/lib/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const DISPLAY_CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY', 'INR'] as const;
const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', CNY: '¥', INR: '₹',
};

const SM_W = 124, SM_HW = 62, SM_H = 30, SM_HH = 15, SM_R = 6;
const SM_W_C = 80, SM_HW_C = 40, SM_H_C = 24, SM_HH_C = 12;

const smLanes: { y: number; h: number; fill: string; label: string }[] = [
  { y: 0, h: 95, fill: '#f0f7ff', label: 'Авто' },
  { y: 95, h: 90, fill: '#fefce8', label: 'Проверка' },
  { y: 185, h: 90, fill: '#f8f9fa', label: 'Исход' },
];

const smNodes: { id: DocumentStatus; label: string; cx: number; cy: number; compact?: boolean }[] = [
  { id: 'parsing', label: 'Распознавание', cx: 100, cy: 50 },
  { id: 'pending', label: 'Ожидает', cx: 260, cy: 50, compact: true },
  { id: 'processing', label: 'Обработка', cx: 420, cy: 50 },
  { id: 'processed', label: 'Обработан', cx: 580, cy: 50 },
  { id: 'requires_review', label: 'На проверку', cx: 100, cy: 140 },
  { id: 'code_review_required', label: 'Проверка кодов', cx: 420, cy: 140 },
  { id: 'failed', label: 'Ошибка', cx: 260, cy: 230 },
  { id: 'processed_with_errors', label: 'С ошибками', cx: 420, cy: 230 },
  { id: 'rejected', label: 'Отклонён', cx: 580, cy: 230 },
];

type SmEdgeType = 'main' | 'branch' | 'manual' | 'reprocess';
const smEdges: { d: string; type: SmEdgeType; label?: { x: number; y: number; text: string } }[] = [
  // Основной автопоток
  { d: 'M162,50 L220,50', type: 'main' },
  { d: 'M300,50 L358,50', type: 'main' },
  { d: 'M482,50 L518,50', type: 'main' },

  // Авто-ветки в «Проверка»
  { d: 'M100,65 L100,125', type: 'branch' },
  { d: 'M420,65 L420,125', type: 'branch' },

  // Авто-ветки в «Исход»
  { d: 'M395,65 C340,120 300,180 280,215', type: 'branch' },
  { d: 'M420,65 C510,100 510,180 420,215', type: 'branch' },
  { d: 'M445,65 C540,120 560,180 570,215', type: 'branch' },
  { d: 'M140,35 C280,-10 590,-10 590,215', type: 'branch' },

  // Ручные действия оператора
  { d: 'M162,140 Q220,100 235,62', type: 'manual', label: { x: 205, y: 93, text: 'утвердить' } },
  { d: 'M125,155 L235,215', type: 'manual', label: { x: 170, y: 193, text: 'отклонить' } },
  { d: 'M482,140 Q535,100 545,65', type: 'manual', label: { x: 520, y: 93, text: 'принять' } },
  { d: 'M482,140 Q535,180 545,215', type: 'manual', label: { x: 520, y: 193, text: 'отклонить' } },

  // Переобработка / пересчёт
  { d: 'M290,215 C200,170 230,100 245,62', type: 'reprocess', label: { x: 225, y: 132, text: 'переобработка' } },
  { d: 'M395,215 C320,160 260,100 270,62', type: 'reprocess' },
  { d: 'M555,35 Q510,15 470,35', type: 'reprocess', label: { x: 515, y: 20, text: 'пересчёт' } },
];

const smEdgeStyle: Record<SmEdgeType, { width: number; dash?: string; opacity?: number }> = {
  main: { width: 2 },
  branch: { width: 1, opacity: 0.9 },
  manual: { width: 1, dash: '4 3' },
  reprocess: { width: 1, dash: '1 3', opacity: 0.8 },
};

function DocumentStateMachine({ status }: { status: DocumentStatus }) {
  return (
    <div style={{ marginBottom: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#fff', overflowX: 'auto' }}>
      <svg viewBox="0 -15 680 290" width={680} height={290} style={{ display: 'block', maxWidth: '100%' }}>
        <defs>
          <marker id="sm-arr" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="7" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0.5 L9,3.5 L0,6.5" fill="#9ca3af" />
          </marker>
        </defs>

        {smLanes.map((lane, i) => (
          <g key={`lane-${i}`}>
            <rect x={0} y={lane.y} width={680} height={lane.h} fill={lane.fill} />
            <text
              x={10}
              y={lane.y + 14}
              fontSize={9}
              fill="#9ca3af"
              fontFamily="system-ui, sans-serif"
              fontWeight={500}
              style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}
            >
              {lane.label}
            </text>
          </g>
        ))}

        {smEdges.map((e, i) => {
          const s = smEdgeStyle[e.type];
          return (
            <path
              key={`edge-${i}`}
              d={e.d}
              fill="none"
              stroke="#9ca3af"
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              opacity={s.opacity ?? 1}
              markerEnd="url(#sm-arr)"
            />
          );
        })}

        {smEdges.map((e, i) =>
          e.label ? (
            <text
              key={`lbl-${i}`}
              x={e.label.x}
              y={e.label.y}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
              fontFamily="system-ui, sans-serif"
              style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }}
            >
              {e.label.text}
            </text>
          ) : null,
        )}

        {smNodes.map((n) => {
          const active = n.id === status;
          const color = statusColors[n.id];
          const w = n.compact ? SM_W_C : SM_W;
          const hw = n.compact ? SM_HW_C : SM_HW;
          const h = n.compact ? SM_H_C : SM_H;
          const hh = n.compact ? SM_HH_C : SM_HH;
          const r = n.compact ? SM_R - 1 : SM_R;
          const fs = n.compact ? 10 : 11;
          return (
            <g key={n.id}>
              {active && (
                <rect
                  x={n.cx - hw - 3}
                  y={n.cy - hh - 3}
                  width={w + 6}
                  height={h + 6}
                  rx={r + 2}
                  fill={color}
                  opacity={0.15}
                />
              )}
              <rect
                x={n.cx - hw}
                y={n.cy - hh}
                width={w}
                height={h}
                rx={r}
                fill={active ? color : '#fff'}
                stroke={active ? color : '#d1d5db'}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={n.cx}
                y={n.cy + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={active ? '#fff' : '#6b7280'}
                fontSize={fs}
                fontWeight={active ? 600 : 400}
                fontFamily="system-ui, sans-serif"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function resolveStatus(row: DocumentResultRow): CalculationStatus {
  if (row.calculationStatus) return row.calculationStatus;
  return row.verificationStatus === 'exact' ? 'exact' : 'partial';
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { document: doc, loading, error, reprocess, recalculate, saveParsedData, reject, approve } = useDocument(id);
  const history = useCalculationHistory(id, doc?.updatedAt);
  const { countries } = useCountries();

  const [reprocessing, setReprocessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [countryDraft, setCountryDraft] = useState<string>('');
  // Серверное значение на момент прошлой синхронизации. Polling обновляет doc каждые 3с —
  // без ref сохранённый draft оператора затирался бы серверным значением при каждом опросе.
  const lastSyncedCountry = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const server = doc?.countryOfOrigin ?? null;
    if (lastSyncedCountry.current !== server) {
      setCountryDraft(server ?? '');
      lastSyncedCountry.current = server;
    }
  }, [doc?.countryOfOrigin]);

  const handleRecalculate = useCallback(async () => {
    setRecalculating(true);
    try {
      await recalculate(countryDraft || undefined);
    } catch {
      // error уже установлен в хуке
    } finally {
      setRecalculating(false);
    }
  }, [recalculate, countryDraft]);

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const toggleRow = useCallback(
    (i: number) => setExpandedRow((prev) => (prev === i ? null : i)),
    [],
  );
  const [editableRows, setEditableRows] = useState<ParsedDataRow[]>([]);
  const [editableCurrency, setEditableCurrency] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('doc-display-currency');
    if (saved) setDisplayCurrency(saved);
  }, []);

  const isReview = doc?.status === 'requires_review';
  const isCodeReview = doc?.status === 'code_review_required';
  const docCurrency = doc?.currency || 'USD';
  const activeCurrency = displayCurrency || docCurrency;

  const conversionRate = useMemo(() => {
    if (activeCurrency === docCurrency) return 1;
    const rates = doc?.exchangeRates;
    if (!rates) return 1;
    const fromRate = rates[docCurrency] ?? 1;
    const toRate = rates[activeCurrency] ?? 1;
    return fromRate / toRate;
  }, [activeCurrency, docCurrency, doc?.exchangeRates]);

  const fmtMoney = useCallback(
    (n: number) => fmt(Math.round(n * conversionRate * 100) / 100),
    [conversionRate],
  );

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
    const trimmed = rejectReason.trim();
    if (isReview && !trimmed) return;
    setRejecting(true);
    try {
      await reject(trimmed);
      setShowRejectForm(false);
      setRejectReason('');
    } finally {
      setRejecting(false);
    }
  };

  const handleAcceptAsIs = async () => {
    setApproving(true);
    try {
      await approve();
    } finally {
      setApproving(false);
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
            <button
              onClick={handleApprove}
              disabled={approving || editableRows.length === 0}
              style={primaryBtnStyle}
            >
              {approving ? 'Сохранение...' : 'Подтвердить и обработать'}
            </button>
          )}
          {isCodeReview && (
            <button
              onClick={handleAcceptAsIs}
              disabled={approving}
              style={primaryBtnStyle}
            >
              {approving ? 'Обработка...' : 'Принять как есть'}
            </button>
          )}
          {(isReview || isCodeReview) && (
            <button
              onClick={() => setShowRejectForm(!showRejectForm)}
              disabled={rejecting}
              style={dangerOutlineBtnStyle}
            >
              Отклонить
            </button>
          )}
          {(doc.status === 'failed' || doc.status === 'processed_with_errors') && (
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
              onClick={() => downloadDocument(doc.id)}
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

      <DocumentStateMachine status={doc.status} />

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
            placeholder={isCodeReview ? 'Комментарий (опционально)' : 'Укажите причину отклонения'}
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
            disabled={rejecting || (isReview && !rejectReason.trim())}
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

      {doc.rejectionReasons && doc.rejectionReasons.length > 0 && (
        <div
          style={{
            padding: 16,
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: '#c2410c' }}>
            {isCodeReview ? 'Строки с низкой уверенностью:' : 'Причины отклонения:'}
          </strong>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: '#9a3412' }}>
            {doc.rejectionReasons.map((reason, i) => (
              <li key={i} style={{ marginBottom: 4, fontSize: 14 }}>{reason}</li>
            ))}
          </ol>
        </div>
      )}

      {doc.status === 'processed_with_errors' && (
        <div
          style={{
            padding: 16,
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: '#d97706' }}>Внимание:</strong>{' '}
          <span style={{ color: '#92400e' }}>
            Документ обработан, но часть строк содержит ошибки классификации.
            Скачивание недоступно. Попробуйте переобработать документ.
          </span>
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

      {/* Country of origin selector */}
      {rows.length > 0 && (() => {
        const recalculateDisabled = recalculating || countryDraft === (doc.countryOfOrigin ?? '');
        return (
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: 12,
              marginBottom: 16,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: doc.countryOriginSource === 'default' ? '#fffbeb' : '#fafafa',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Страна происхождения</div>
              <select
                value={countryDraft}
                onChange={(e) => setCountryDraft(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: 14,
                  borderRadius: 4,
                  border: '1px solid #ddd',
                  background: '#fff',
                  minWidth: 260,
                }}
              >
                <option value="">— не указана —</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameRu} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: '#6b7280' }}>
              {doc.countryOriginSource && (
                <div>
                  Источник: <span style={{ color: '#374151' }}>{countryOriginSourceLabels[doc.countryOriginSource]}</span>
                </div>
              )}
              {doc.countryDetectionReason && (
                <div style={{ marginTop: 2, fontStyle: 'italic' }}>{doc.countryDetectionReason}</div>
              )}
            </div>
            <button
              onClick={handleRecalculate}
              disabled={recalculateDisabled}
              style={{
                padding: '8px 16px',
                background: recalculateDisabled ? '#9ca3af' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: recalculateDisabled ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              {recalculating ? 'Пересчёт...' : 'Пересчитать'}
            </button>
          </div>
        );
      })()}

      {/* Result data table */}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Результаты расчёта</h3>
            {doc.exchangeRates && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 13, color: '#666' }}>Валюта:</label>
                <select
                  value={displayCurrency}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDisplayCurrency(val);
                    if (val) localStorage.setItem('doc-display-currency', val);
                    else localStorage.removeItem('doc-display-currency');
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: 13,
                    borderRadius: 4,
                    border: '1px solid #ddd',
                    background: '#fff',
                  }}
                >
                  <option value="">{CURRENCY_SYMBOLS[docCurrency] ?? ''} {docCurrency} (оригинал)</option>
                  {DISPLAY_CURRENCIES.filter(c => c !== docCurrency).map(cur => (
                    <option key={cur} value={cur}>{CURRENCY_SYMBOLS[cur]} {cur}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 40 }}>#</th>
                  <th style={{ ...th, width: 50 }}></th>
                  <th style={{ ...th, minWidth: 200 }}>Наименование</th>
                  <th style={{ ...th, minWidth: 100 }}>Код ТН ВЭД</th>
                  <th style={{ ...thR, minWidth: 90 }}>Сумма ({activeCurrency})</th>
                  <th style={{ ...thR, minWidth: 90 }}>Итого ({activeCurrency})</th>
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
                    fmtMoney={fmtMoney}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={td} colSpan={4}>Итого</td>
                  <td style={tdR}>{fmtMoney(totals.totalPrice)}</td>
                  <td style={tdR}>{fmtMoney(totals.totalCost)}</td>
                  <td style={td} colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {(doc.status === 'processed' || doc.status === 'processed_with_errors') && rows.length === 0 && (
        <p style={{ color: '#888' }}>Нет данных результата</p>
      )}

      {history.length >= 2 && (
        <>
          <h3 style={{ marginTop: 32, marginBottom: 12 }}>История расчётов</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Дата</th>
                  <th style={thR}>Товаров</th>
                  <th style={thR}>Итого</th>
                  <th style={thR}>Пошлина</th>
                  <th style={thR}>НДС</th>
                  <th style={th}>Валюта</th>
                </tr>
              </thead>
              <tbody>
                {history.map((log) => (
                  <tr key={log.id}>
                    <td style={td}>{new Date(log.createdAt).toLocaleString('ru')}</td>
                    <td style={tdR}>{log.itemsCount}</td>
                    <td style={tdR}>{log.resultSummary ? fmt(log.resultSummary.grandTotal) : '—'}</td>
                    <td style={tdR}>{log.resultSummary ? fmt(log.resultSummary.totalDuty) : '—'}</td>
                    <td style={tdR}>{log.resultSummary ? fmt(log.resultSummary.totalVat) : '—'}</td>
                    <td style={td}>{log.resultSummary?.currency ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  row,
  index,
  isExpanded,
  onToggle,
  fmtMoney,
}: {
  row: DocumentResultRow;
  index: number;
  isExpanded: boolean;
  onToggle: (index: number) => void;
  fmtMoney: (n: number) => string;
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
        <td style={tdR}>{fmtMoney(row.totalPrice)}</td>
        <td style={tdR}>{fmtMoney(row.totalCost)}</td>
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

      {isExpanded && <ResultDetail row={row} fmtMoney={fmtMoney} />}
    </>
  );
});

function ResultDetail({ row, fmtMoney }: { row: DocumentResultRow; fmtMoney: (n: number) => string }) {
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
              <DetailField label="Цена за ед." value={fmtMoney(row.price)} />
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
            <CalcLine label="Сумма товара" value={fmtMoney(row.totalPrice)} />
            <CalcLine
              label="Пошлина"
              value={fmtMoney(row.dutyAmount)}
              note={row.dutyAmountIsEstimate ? 'оценочная' : undefined}
            />
            <CalcLine label="НДС" value={fmtMoney(row.vatAmount)} />
            <CalcLine
              label="Акциз"
              value={row.exciseAmount > 0 ? fmtMoney(row.exciseAmount) : '—'}
            />
            <CalcLine label="Комиссия доставки" value={fmtMoney(row.logisticsCommission)} />
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
              <span>{fmtMoney(row.totalCost)}</span>
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

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const dangerOutlineBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#fff',
  color: '#dc2626',
  border: '1px solid #dc2626',
  borderRadius: 4,
  cursor: 'pointer',
};

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
