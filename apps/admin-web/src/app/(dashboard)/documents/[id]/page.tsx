'use client';

import { InfoCard } from '@/components/info-card';
import { useCalculationHistory } from '@/hooks/use-calculation-history';
import { useCountries } from '@/hooks/use-countries';
import { useDocument } from '@/hooks/use-document';
import { useDocumentRegulatoryExplanations } from '@/hooks/use-document-regulatory-explanations';
import { RegulatoryRequirementsSection } from '../../tn-ved/regulatory-section';
import { DiagnosticsPanel } from './diagnostics-panel';
import { countryOriginSourceLabels, downloadDocument, statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, calcAiCostFromStages, fmt, fmtCost, fmtDateTimeLocale, fmtTokens, modelLabel, stageLabel } from '@/lib/format';
import { btnDangerOutline, btnOutline, btnPrimary, btnSuccess, btnWarning } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import type { CalculationStatus, CodeCandidate, DocumentResultRow, DocumentStatus, ParsedDataRow, ProductNoteSeverity } from '@/lib/types';
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

type StepperStageState = 'done' | 'active' | 'pending' | 'warning' | 'error' | 'success';

type StepperStage = { key: string; label: string; state: StepperStageState };

const STAGE_COLORS: Record<StepperStageState, { fill: string; ring: string; text: string }> = {
  done: { fill: '#16a34a', ring: '#16a34a', text: '#374151' },
  active: { fill: '#2563eb', ring: '#2563eb', text: '#111827' },
  pending: { fill: '#fff', ring: '#d1d5db', text: '#9ca3af' },
  warning: { fill: '#ca8a04', ring: '#ca8a04', text: '#111827' },
  error: { fill: '#dc2626', ring: '#dc2626', text: '#111827' },
  success: { fill: '#16a34a', ring: '#16a34a', text: '#111827' },
};

const isCompleteStage = (s: StepperStageState) => s === 'done' || s === 'success';
const isEmphasizedStage = (s: StepperStageState) => s === 'active' || s === 'warning' || s === 'error';

function buildStepperStages(status: DocumentStatus): { stages: StepperStage[]; hint: string } {
  const s = (k: string, label: string, state: StepperStageState): StepperStage => ({ key: k, label, state });

  switch (status) {
    case 'parsing':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознавание', 'active'), s('p', 'Обработка', 'pending'), s('d', 'Готов', 'pending')],
        hint: 'AI распознаёт структуру таблицы и переводит наименования',
      };
    case 'requires_review':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'warning'), s('p', 'Обработка', 'pending'), s('d', 'Готов', 'pending')],
        hint: 'Оператор должен проверить распознанные данные',
      };
    case 'pending':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработка', 'active'), s('d', 'Готов', 'pending')],
        hint: 'Документ в очереди на обработку',
      };
    case 'processing':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработка', 'active'), s('d', 'Готов', 'pending')],
        hint: 'Классификация ТН ВЭД и расчёт пошлин',
      };
    case 'code_review_required':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработка', 'warning'), s('d', 'Готов', 'pending')],
        hint: 'Оператор должен проверить предложенные коды ТН ВЭД',
      };
    case 'processed':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработан', 'done'), s('d', 'Готов', 'success')],
        hint: 'Документ готов, можно скачать Excel',
      };
    case 'processed_with_errors':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработан', 'done'), s('d', 'Готов', 'warning')],
        hint: 'Часть строк с ошибками классификации — см. замечания ниже',
      };
    case 'failed':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработка', 'error'), s('d', 'Готов', 'pending')],
        hint: 'Сбой обработки — см. сообщение об ошибке ниже',
      };
    case 'rejected':
      return {
        stages: [s('u', 'Загружен', 'done'), s('r', 'Распознан', 'done'), s('p', 'Обработка', 'error'), s('d', 'Готов', 'pending')],
        hint: 'Документ отклонён оператором',
      };
  }
}

function DocumentStatusStepper({ status }: { status: DocumentStatus }) {
  const { stages, hint } = buildStepperStages(status);

  return (
    <div
      style={{
        marginBottom: 24,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '16px 20px',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {stages.map((stage, i) => {
          const colors = STAGE_COLORS[stage.state];
          const isLast = i === stages.length - 1;
          const isActive = stage.state === 'active';
          const showInner = isCompleteStage(stage.state);
          const nextDone = !isLast && isCompleteStage(stages[i + 1].state);
          return (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: stage.state === 'pending' ? '#fff' : colors.fill,
                    border: `2px solid ${colors.ring}`,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isActive ? `0 0 0 4px ${colors.ring}1f` : undefined,
                    position: 'relative',
                  }}
                >
                  {showInner && (
                    <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.2 L5 8.5 L9.5 3.8" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {stage.state === 'error' && (
                    <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                      <path d="M3 3 L9 9 M9 3 L3 9" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  )}
                  {stage.state === 'warning' && (
                    <div style={{ width: 4, height: 4, background: '#fff', borderRadius: '50%' }} />
                  )}
                  {isActive && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: -2,
                        borderRadius: '50%',
                        border: `2px solid ${colors.ring}`,
                        opacity: 0.4,
                        animation: 'dp-pulse 1.4s ease-in-out infinite',
                      }}
                    />
                  )}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    color: colors.text,
                    fontWeight: isEmphasizedStage(stage.state) ? 600 : 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {stage.label}
                </span>
              </div>
              {!isLast && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: nextDone ? STAGE_COLORS.done.fill : '#e5e7eb',
                    margin: '0 12px',
                    minWidth: 16,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: '#6b7280', paddingLeft: 34 }}>{hint}</div>
    </div>
  );
}

function resolveStatus(row: DocumentResultRow): CalculationStatus {
  if (row.calculationStatus) return row.calculationStatus;
  return row.verificationStatus === 'exact' ? 'exact' : 'partial';
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { document: doc, loading, error, reprocess, recalculate, saveParsedData, reject, approve, setRowCode } = useDocument(id);
  const history = useCalculationHistory(id, doc?.updatedAt);
  const { countries } = useCountries();

  const [reprocessing, setReprocessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [countryDraft, setCountryDraft] = useState<string>('');
  const [freightCostDraft, setFreightCostDraft] = useState<string>('');
  const [freightCurrencyDraft, setFreightCurrencyDraft] = useState<'USD' | 'CNY' | 'RUB' | 'EUR'>('USD');
  // Polling каждые 3с обновляет doc — без отслеживания last-synced серверного значения
  // ввод оператора затирался бы при каждом опросе.
  const lastSyncedCountry = useRef<string | null | undefined>(undefined);
  const lastSyncedFreight = useRef<string | undefined>(undefined);

  useEffect(() => {
    const server = doc?.countryOfOrigin ?? null;
    if (lastSyncedCountry.current !== server) {
      setCountryDraft(server ?? '');
      lastSyncedCountry.current = server;
    }
  }, [doc?.countryOfOrigin]);

  useEffect(() => {
    // Сравниваем по строковому ключу — иначе float-сравнение doc.freightCost
    // и draft даёт ложные срабатывания.
    const serverKey = `${doc?.freightCost ?? ''}|${doc?.freightCurrency ?? 'USD'}`;
    if (lastSyncedFreight.current !== serverKey) {
      setFreightCostDraft(doc?.freightCost != null ? String(doc.freightCost) : '');
      setFreightCurrencyDraft((doc?.freightCurrency as 'USD' | 'CNY' | 'RUB' | 'EUR') ?? 'USD');
      lastSyncedFreight.current = serverKey;
    }
  }, [doc?.freightCost, doc?.freightCurrency]);

  const handleRecalculate = useCallback(async () => {
    setRecalculating(true);
    try {
      const parsed = freightCostDraft.trim()
        ? Number(freightCostDraft.replace(',', '.'))
        : 0;
      const params: {
        countryOfOrigin?: string;
        freightCost?: number;
        freightCurrency?: 'USD' | 'CNY' | 'RUB' | 'EUR';
      } = {};
      if (countryDraft) params.countryOfOrigin = countryDraft;
      // Отправляем freight только если поле редактировалось пользователем
      // (отличается от сохранённого) — иначе сервер использует текущее значение.
      const currentCost = doc?.freightCost ?? null;
      const currentCurrency = doc?.freightCurrency ?? null;
      const draftCost = parsed > 0 ? parsed : 0;
      const draftCurrency = parsed > 0 ? freightCurrencyDraft : null;
      if (draftCost !== (currentCost ?? 0) || draftCurrency !== currentCurrency) {
        params.freightCost = draftCost;
        if (draftCost > 0) params.freightCurrency = freightCurrencyDraft;
      }
      await recalculate(params);
    } catch {
      /* error выставлен в хуке */
    } finally {
      setRecalculating(false);
    }
  }, [recalculate, countryDraft, freightCostDraft, freightCurrencyDraft, doc?.freightCost, doc?.freightCurrency]);

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const toggleRow = useCallback(
    (i: number) => setExpandedRow((prev) => (prev === i ? null : i)),
    [],
  );
  // Lazy-load AI-выжимок: один запрос на весь документ при первом раскрытии любой строки.
  // После этого данные кэшируются в state до анмаунта/смены документа.
  const explanationsState = useDocumentRegulatoryExplanations(
    doc?.id ?? null,
    expandedRow !== null,
  );
  const [activeTab, setActiveTab] = useState<'main' | 'diagnostics'>('main');
  const [editableRows, setEditableRows] = useState<ParsedDataRow[]>([]);
  const [editableCurrency, setEditableCurrency] = useState('');
  // Тот же паттерн что для countryDraft: polling обновляет doc.parsedData ссылочно,
  // но при настоящей правке ref защищает draft оператора от перетирания.
  const lastSyncedParsedData = useRef<ParsedDataRow[] | null | undefined>(undefined);
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
    const server = doc?.parsedData ?? null;
    if (server && lastSyncedParsedData.current !== server) {
      setEditableRows(
        server.map((r) => ({
          description: String(r.description ?? ''),
          quantity: Number(r.quantity) || 0,
          price: Number(r.price) || 0,
          weight: Number(r.weight) || 0,
        })),
      );
      setEditableCurrency(doc?.currency || '');
      lastSyncedParsedData.current = server;
    }
  }, [doc?.parsedData, doc?.currency]);

  const rows = useMemo(() => doc?.resultData ?? [], [doc?.resultData]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.totalPrice += r.totalPrice;
          acc.freightShare += r.freightShare ?? 0;
          acc.dutyAmount += r.dutyAmount;
          acc.vatAmount += r.vatAmount;
          acc.exciseAmount += r.exciseAmount;
          acc.logisticsCommission += r.logisticsCommission;
          acc.totalCost += r.totalCost;
          return acc;
        },
        {
          totalPrice: 0,
          freightShare: 0,
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
      // saveParsedData бросает при ошибке — это пропускает reprocess
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
              style={btnSuccess}
            >
              {approving ? 'Сохранение...' : 'Подтвердить и обработать'}
            </button>
          )}
          {isCodeReview && (
            <button
              onClick={handleAcceptAsIs}
              disabled={approving}
              style={btnSuccess}
            >
              {approving ? 'Обработка...' : 'Принять как есть'}
            </button>
          )}
          {(isReview || isCodeReview) && (
            <button
              onClick={() => setShowRejectForm(!showRejectForm)}
              disabled={rejecting}
              style={btnDangerOutline}
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
              style={btnWarning}
            >
              {reprocessing ? 'Отправка...' : 'Переобработать'}
            </button>
          )}
          {doc.status === 'processed' && (
            <button onClick={() => downloadDocument(doc.id)} style={btnPrimary}>
              Скачать Excel
            </button>
          )}
        </div>
      </div>

      <DocumentStatusStepper status={doc.status} />

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 20,
        }}
      >
        {(['main', 'diagnostics'] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#2563eb' : '#6b7280',
              }}
            >
              {tab === 'main' ? 'Основное' : 'Диагностика'}
            </button>
          );
        })}
      </div>

      {activeTab === 'diagnostics' ? (
        <DiagnosticsPanel documentId={id} />
      ) : (
        <>

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
        {doc.freightCost != null && doc.freightCost > 0 && doc.freightCurrency && (
          <InfoCard
            label="Фрахт до границы"
            value={`${fmt(doc.freightCost)} ${doc.freightCurrency}`}
          />
        )}
        <InfoCard label="Пользователь" value={getDocumentUploaderName(doc)} />
        <InfoCard label="Создан" value={fmtDateTimeLocale(doc.createdAt)} />
        <InfoCard label="Обновлён" value={fmtDateTimeLocale(doc.updatedAt)} />
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

      {/* Country of origin + freight selector */}
      {rows.length > 0 && (() => {
        const countryChanged = countryDraft !== (doc.countryOfOrigin ?? '');
        const parsedFreight = freightCostDraft.trim()
          ? Number(freightCostDraft.replace(',', '.'))
          : 0;
        const currentCost = doc.freightCost ?? 0;
        const currentCurrency = doc.freightCurrency ?? null;
        const freightChanged =
          parsedFreight !== currentCost ||
          (parsedFreight > 0 && freightCurrencyDraft !== currentCurrency);
        const recalculateDisabled = recalculating || (!countryChanged && !freightChanged);
        return (
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-end',
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
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Фрахт до границы</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={freightCostDraft}
                  onChange={(e) => setFreightCostDraft(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 14,
                    borderRadius: 4,
                    border: '1px solid #ddd',
                    background: '#fff',
                    width: 140,
                  }}
                />
                <select
                  aria-label="Валюта фрахта"
                  value={freightCurrencyDraft}
                  onChange={(e) =>
                    setFreightCurrencyDraft(e.target.value as 'USD' | 'CNY' | 'RUB' | 'EUR')
                  }
                  style={{
                    padding: '6px 10px',
                    fontSize: 14,
                    borderRadius: 4,
                    border: '1px solid #ddd',
                    background: '#fff',
                  }}
                >
                  {(['USD', 'CNY', 'RUB', 'EUR'] as const).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
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
                    canEditCode={isCodeReview || doc.status === 'processed_with_errors'}
                    onSetCode={setRowCode}
                    explanations={explanationsState}
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
                  <th style={th}>Тип</th>
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
                    <td style={td}>{fmtDateTimeLocale(log.createdAt)}</td>
                    <td style={td}>{log.trigger === 'recalculate' ? 'Пересчёт' : 'Полный'}</td>
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
  canEditCode,
  onSetCode,
  explanations,
}: {
  row: DocumentResultRow;
  index: number;
  isExpanded: boolean;
  onToggle: (index: number) => void;
  fmtMoney: (n: number) => string;
  canEditCode: boolean;
  onSetCode: (rowIndex: number, tnVedCode: string) => Promise<void>;
  explanations: import('@/hooks/use-regulatory-explanations').RegulatoryExplanationsState;
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

      {isExpanded && (
        <ResultDetail
          row={row}
          rowIndex={index}
          fmtMoney={fmtMoney}
          canEditCode={canEditCode}
          onSetCode={onSetCode}
          explanations={explanations}
        />
      )}
    </>
  );
});

function ResultDetail({
  row,
  rowIndex,
  fmtMoney,
  canEditCode,
  onSetCode,
  explanations,
}: {
  row: DocumentResultRow;
  rowIndex: number;
  fmtMoney: (n: number) => string;
  canEditCode: boolean;
  onSetCode: (rowIndex: number, tnVedCode: string) => Promise<void>;
  explanations: import('@/hooks/use-regulatory-explanations').RegulatoryExplanationsState;
}) {
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
            {row.freightShare != null && row.freightShare > 0 && (
              <CalcLine label="Фрахт до границы" value={fmtMoney(row.freightShare)} />
            )}
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
        {canEditCode && (
          <div style={{ padding: '0 12px 16px', background: '#fafafa' }}>
            <ChangeCodeSection
              rowIndex={rowIndex}
              currentCode={row.tnVedCode}
              candidateCodes={row.candidateCodes ?? null}
              onSetCode={onSetCode}
            />
          </div>
        )}
        {row.regulatoryReport ? (
          <div style={{ padding: '0 12px 16px', background: '#fafafa' }}>
            <RegulatoryRequirementsSection
              report={row.regulatoryReport}
              explanations={explanations}
            />
          </div>
        ) : (
          <div style={{ padding: '0 12px 16px', background: '#fafafa', fontSize: 12, color: '#888' }}>
            Разрешительные документы для этой строки не рассчитаны (документ обработан до релиза
            фичи). Запустите пересчёт, чтобы получить список.
          </div>
        )}
      </td>
    </tr>
  );
}

function ChangeCodeSection({
  rowIndex,
  currentCode,
  candidateCodes,
  onSetCode,
}: {
  rowIndex: number;
  currentCode: string;
  candidateCodes: CodeCandidate[] | null;
  onSetCode: (rowIndex: number, tnVedCode: string) => Promise<void>;
}) {
  const [customCode, setCustomCode] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const apply = async (code: string) => {
    setSubmitting(code);
    setLocalError(null);
    try {
      await onSetCode(rowIndex, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось применить код';
      setLocalError(msg === 'setRowCode failed' ? null : msg);
    } finally {
      setSubmitting(null);
    }
  };

  const customValid = /^\d{10}$/.test(customCode.trim());

  return (
    <div
      style={{
        border: '1px solid #fcd34d',
        background: '#fffbeb',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 10 }}>
        Изменить код ТН ВЭД
      </div>
      {candidateCodes && candidateCodes.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#78350f', marginBottom: 8 }}>
            Варианты, которые рассматривал AI при классификации:
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {candidateCodes.map((cand) => {
              const isCurrent = cand.code === currentCode;
              const isSubmitting = submitting === cand.code;
              return (
                <div
                  key={cand.code}
                  style={{
                    border: isCurrent ? '2px solid #16a34a' : '1px solid #fcd34d',
                    borderRadius: 6,
                    padding: 10,
                    background: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <code style={{ fontSize: 13, fontWeight: 600 }}>{cand.code}</code>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>
                      conf {cand.confidence.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.3 }}>
                    {cand.description}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    Пошлина {cand.dutyRate}
                    {cand.dutyRateUnit ? ` ${cand.dutyRateUnit}` : '%'}
                    {' · '}НДС {cand.vatRate}%
                    {cand.exciseRate > 0 && ` · Акциз ${cand.exciseRate}%`}
                  </div>
                  {cand.reasoning && (
                    <div style={{ fontSize: 11, color: '#92400e', fontStyle: 'italic' }}>
                      {cand.reasoning}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => apply(cand.code)}
                    disabled={isCurrent || submitting !== null}
                    style={{
                      marginTop: 'auto',
                      padding: '4px 10px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: 'none',
                      cursor: isCurrent || submitting !== null ? 'not-allowed' : 'pointer',
                      background: isCurrent ? '#dcfce7' : '#2563eb',
                      color: isCurrent ? '#15803d' : '#fff',
                      fontWeight: 500,
                    }}
                  >
                    {isCurrent ? 'Текущий код' : isSubmitting ? 'Применяется...' : 'Выбрать'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#78350f' }}>Свой код:</label>
        <input
          type="text"
          value={customCode}
          onChange={(e) => setCustomCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="10 цифр"
          maxLength={10}
          style={{
            padding: '4px 8px',
            border: '1px solid #fcd34d',
            borderRadius: 4,
            fontSize: 13,
            width: 130,
            fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={() => apply(customCode.trim())}
          disabled={!customValid || submitting !== null}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            borderRadius: 4,
            border: 'none',
            cursor: customValid && submitting === null ? 'pointer' : 'not-allowed',
            background: customValid && submitting === null ? '#2563eb' : '#9ca3af',
            color: '#fff',
            fontWeight: 500,
          }}
        >
          {submitting === customCode.trim() ? 'Применяется...' : 'Применить'}
        </button>
        {!candidateCodes?.length && (
          <span style={{ fontSize: 11, color: '#78350f' }}>
            AI не предложил альтернатив — введите код вручную.
          </span>
        )}
      </div>
      {localError && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{localError}</div>
      )}
    </div>
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
