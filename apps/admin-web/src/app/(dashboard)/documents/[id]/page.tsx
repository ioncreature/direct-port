'use client';

import { InfoTooltip } from '@/components/info-tooltip';
import { TabsNav } from '@/components/tabs-nav';
import { useCalculationHistory } from '@/hooks/use-calculation-history';
import { useCountries } from '@/hooks/use-countries';
import { useDocument } from '@/hooks/use-document';
import { useDocumentPhotos } from '@/hooks/use-document-photos';
import { useDocumentRegulatoryExplanations } from '@/hooks/use-document-regulatory-explanations';
import { RegulatoryRequirementsSection, type OriginCountry } from '../../tn-ved/regulatory-section';
import { DiagnosticsPanel } from './diagnostics-panel';
import { PhotoLightbox, PhotoThumb } from './photos';
import { countryOriginSourceLabels, downloadDocument, statusColors, statusLabels } from '@/lib/documents';
import { fmt, fmtDateTimeLocale } from '@/lib/format';
import { btnDangerOutline, btnOutline, btnPrimary, btnSuccess, btnWarning, cardSurface } from '@/lib/table-styles';
import { getDocumentUploaderName } from '@/lib/telegram';
import { INCOTERMS } from '@/lib/types';
import type { CalculationStatus, CodeCandidate, DocumentPhotoRow, DocumentResultRow, DocumentStatus, ParsedDataRow, ProductNoteSeverity } from '@/lib/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const calcStatusConfig: Record<CalculationStatus, { label: string; color: string; bg: string }> = {
  exact: { label: 'Точное', color: 'var(--success)', bg: 'var(--success-soft)' },
  partial: { label: 'Есть замечания', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  needs_info: { label: 'Требует уточнения', color: 'var(--orange-strong)', bg: 'var(--orange-soft-border)' },
  error: { label: 'Ошибка', color: 'var(--danger)', bg: 'var(--danger-soft)' },
};

const noteSeverityConfig: Record<ProductNoteSeverity, { icon: string; color: string }> = {
  blocker: { icon: '!!', color: 'var(--danger)' },
  warning: { icon: '!', color: 'var(--warning)' },
  info: { icon: 'i', color: 'var(--text-muted)' },
};

const severityOrder: ProductNoteSeverity[] = ['blocker', 'warning', 'info'];

const DISPLAY_CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY', 'INR'] as const;
const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽', USD: '$', EUR: '€', CNY: '¥', INR: '₹',
};

// Краткие подсказки для полей формы пересчёта (попапы «?»). Подробности — на странице /reference.
const COUNTRY_HINT =
  'Страна, где произведён товар. Задаёт ставку ввозной пошлины (включая антидемпинговые пошлины и тарифные преференции), попадает в графу 34 ДТ и влияет на страновые запреты. AI определяет её автоматически — при ошибке выберите вручную и нажмите «Пересчитать».';
const FREIGHT_HINT =
  'Стоимость доставки до границы ЕАЭС в выбранной валюте. Распределяется по позициям пропорционально весу брутто и входит в таможенную стоимость, увеличивая базу пошлины, акциза и НДС. Введите 0 или очистите поле, чтобы сбросить.';
const INCOTERMS_HINT =
  'Условия поставки (Incoterms 2020): что уже включено в цену товара, а что нужно добавить в таможенную стоимость. Влияют на предупреждения о занижении ТС (EXW/FCA/FOB…) или двойном счёте фрахта (CIF/CIP/DAP…).';

type StepperStageState = 'done' | 'active' | 'pending' | 'warning' | 'error' | 'success';

type StepperStage = { key: string; label: string; state: StepperStageState };

const STAGE_COLORS: Record<StepperStageState, { fill: string; ring: string; text: string }> = {
  done: { fill: 'var(--success)', ring: 'var(--success)', text: 'var(--text)' },
  active: { fill: 'var(--accent)', ring: 'var(--accent)', text: 'var(--text)' },
  pending: { fill: '#fff', ring: 'var(--border-strong)', text: 'var(--text-subtle)' },
  warning: { fill: 'var(--warning)', ring: 'var(--warning)', text: 'var(--text)' },
  error: { fill: 'var(--danger)', ring: 'var(--danger)', text: 'var(--text)' },
  success: { fill: 'var(--success)', ring: 'var(--success)', text: 'var(--text)' },
};

const isCompleteStage = (s: StepperStageState) => s === 'done' || s === 'success';
const isEmphasizedStage = (s: StepperStageState) => s === 'active' || s === 'warning' || s === 'error';

function buildStepperStages(status: DocumentStatus): { stages: StepperStage[]; hint: string } {
  const s = (k: string, label: string, state: StepperStageState): StepperStage => ({ key: k, label, state });

  switch (status) {
    case 'intake':
      return {
        stages: [s('u', 'Получен', 'done'), s('r', 'Распознавание', 'pending'), s('p', 'Обработка', 'pending'), s('d', 'Готов', 'pending')],
        hint: 'Файл получен от клиента — запустите расчёт, когда будете готовы',
      };
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

function DocumentStatusStepper({ status, meta }: { status: DocumentStatus; meta?: React.ReactNode }) {
  const { stages, hint } = buildStepperStages(status);

  return (
    <div style={{ ...cardSurface, marginBottom: 24, padding: '16px 20px' }}>
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
                    background: nextDone ? STAGE_COLORS.done.fill : 'var(--border)',
                    margin: '0 12px',
                    minWidth: 16,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)', paddingLeft: 34 }}>{hint}</div>
      {meta && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px 32px',
          }}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

/** Пара «подпись → значение» в мета-строке карточки статуса. */
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div title={value} style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>
        {value}
      </div>
    </div>
  );
}

function resolveStatus(row: DocumentResultRow): CalculationStatus {
  if (row.calculationStatus) return row.calculationStatus;
  return row.verificationStatus === 'exact' ? 'exact' : 'partial';
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { document: doc, loading, error, reprocess, recalculate, saveParsedData, reject, approve, start, setRowCode } = useDocument(id);
  const history = useCalculationHistory(id, doc?.updatedAt);
  const { countries } = useCountries();

  const [reprocessing, setReprocessing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [countryDraft, setCountryDraft] = useState<string>('');
  const [freightCostDraft, setFreightCostDraft] = useState<string>('');
  const [freightCurrencyDraft, setFreightCurrencyDraft] = useState<'USD' | 'CNY' | 'RUB' | 'EUR'>('USD');
  const [incotermsDraft, setIncotermsDraft] = useState<string>('');
  // Polling каждые 3с обновляет doc — без отслеживания last-synced серверного значения
  // ввод оператора затирался бы при каждом опросе.
  const lastSyncedCountry = useRef<string | null | undefined>(undefined);
  const lastSyncedFreight = useRef<string | undefined>(undefined);
  const lastSyncedIncoterms = useRef<string | null | undefined>(undefined);

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

  useEffect(() => {
    const server = doc?.incoterms ?? null;
    if (lastSyncedIncoterms.current !== server) {
      setIncotermsDraft(server ?? '');
      lastSyncedIncoterms.current = server;
    }
  }, [doc?.incoterms]);

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
        incoterms?: string;
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
      if (incotermsDraft !== (doc?.incoterms ?? '')) {
        params.incoterms = incotermsDraft; // '' — сброс условий
      }
      await recalculate(params);
    } catch {
      /* error выставлен в хуке */
    } finally {
      setRecalculating(false);
    }
  }, [recalculate, countryDraft, freightCostDraft, freightCurrencyDraft, incotermsDraft, doc?.freightCost, doc?.freightCurrency, doc?.incoterms]);

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const toggleRow = useCallback(
    (i: number) => setExpandedRow((prev) => (prev === i ? null : i)),
    [],
  );
  // Фото появляются в БД после парсинга — грузим миниатюры, как только у документа
  // появились строки (условие переключается polling'ом doc).
  const photosByRow = useDocumentPhotos(
    doc?.id ?? null,
    (doc?.parsedData?.length ?? 0) > 0 || (doc?.resultData?.length ?? 0) > 0,
  );
  const [lightboxPhoto, setLightboxPhoto] = useState<DocumentPhotoRow | null>(null);
  const closePhoto = useCallback(() => setLightboxPhoto(null), []);
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
  const isIntake = doc?.status === 'intake';
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
  // Страна происхождения каждой строки (строчная перекрывает страну документа) —
  // для фильтрации страновых мер в регуляторном блоке. Мемо сохраняет ссылки
  // стабильными, чтобы не ломать memo() у ResultRow.
  const countryNameByCode = useMemo(
    () => new Map(countries.map((c) => [c.code, c.nameRu])),
    [countries],
  );
  const docCountry = doc?.countryOfOrigin ?? null;
  const rowOrigins = useMemo(
    () =>
      rows.map((row) => {
        const code = row.countryOfOrigin ?? docCountry;
        if (!code) return null;
        return { code, name: countryNameByCode.get(code) ?? code };
      }),
    [rows, docCountry, countryNameByCode],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.totalPrice += r.totalPrice;
          acc.freightShare += r.freightShare ?? 0;
          acc.dutyAmount += r.dutyAmount;
          acc.vatAmount += r.vatAmount;
          acc.exciseAmount += r.exciseAmount;
          acc.totalCost += r.totalCost;
          return acc;
        },
        {
          totalPrice: 0,
          freightShare: 0,
          dutyAmount: 0,
          vatAmount: 0,
          exciseAmount: 0,
          totalCost: 0,
        },
      ),
    [rows],
  );

  if (loading) return <p>Загрузка...</p>;
  if (error || !doc) return <p style={{ color: 'var(--danger)' }}>{error || 'Документ не найден'}</p>;

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
        <Link href="/documents" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 14 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{doc.originalFileName}</h1>
          <span
            style={{
              flexShrink: 0,
              padding: '3px 10px',
              borderRadius: 'var(--radius-pill)',
              border: `1px solid ${statusColors[doc.status]}`,
              color: statusColors[doc.status],
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {statusLabels[doc.status]}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {isIntake && (
            <button
              onClick={async () => {
                setStarting(true);
                try {
                  await start();
                } finally {
                  setStarting(false);
                }
              }}
              disabled={starting}
              style={btnSuccess}
            >
              {starting ? 'Запуск...' : '🚀 Запустить расчёт'}
            </button>
          )}
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

      <DocumentStatusStepper
        status={doc.status}
        meta={
          <>
            <MetaItem label="Строк" value={String(doc.rowCount)} />
            {doc.currency && <MetaItem label="Валюта" value={doc.currency} />}
            {doc.freightCost != null && doc.freightCost > 0 && doc.freightCurrency && (
              <MetaItem
                label="Фрахт до границы"
                value={`${fmt(doc.freightCost)} ${doc.freightCurrency}`}
              />
            )}
            {doc.incoterms && <MetaItem label="Условия поставки" value={doc.incoterms} />}
            <MetaItem label="Пользователь" value={getDocumentUploaderName(doc)} />
            <MetaItem label="Создан" value={fmtDateTimeLocale(doc.createdAt)} />
            <MetaItem label="Обновлён" value={fmtDateTimeLocale(doc.updatedAt)} />
          </>
        }
      />

      <TabsNav
        tabs={['main', 'diagnostics'] as const}
        active={activeTab}
        onChange={setActiveTab}
        labels={{ main: 'Основное', diagnostics: 'Диагностика' }}
      />

      {activeTab === 'diagnostics' ? (
        <DiagnosticsPanel documentId={id} tokenUsage={doc.tokenUsage} />
      ) : (
        <>

      {/* Reject form */}
      {showRejectForm && (
        <div
          style={{
            padding: 16,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-soft-border)',
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
              border: '1px solid var(--border)',
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
              background: 'var(--danger)',
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
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Отмена
          </button>
        </div>
      )}

      {doc.errorMessage && (
        <div
          style={{
            padding: 16,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-soft-border)',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: 'var(--danger)' }}>Ошибка:</strong>{' '}
          <span style={{ color: 'var(--danger-strong)' }}>{doc.errorMessage}</span>
        </div>
      )}

      {doc.rejectionReasons && doc.rejectionReasons.length > 0 && (
        <div
          style={{
            padding: 16,
            background: 'var(--orange-soft)',
            border: '1px solid var(--orange-soft-border)',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: 'var(--orange-strong)' }}>
            {isCodeReview ? 'Строки с низкой уверенностью:' : 'Причины отклонения:'}
          </strong>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: '#8f3f1b' }}>
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
            background: 'var(--warning-soft)',
            border: '1px solid var(--warning-soft-border)',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: 'var(--warning)' }}>Внимание:</strong>{' '}
          <span style={{ color: 'var(--warning-strong)' }}>
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
              <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Валюта:
                <input
                  type="text"
                  value={editableCurrency}
                  onChange={(e) => setEditableCurrency(e.target.value.toUpperCase())}
                  style={{
                    marginLeft: 6,
                    width: 60,
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
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
                  <th style={{ ...th, width: 50 }}></th>
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
                    {/* Фото привязаны к позиции строки на момент парсинга: после
                        удаления/добавления строк привязка смещается — так же, как
                        сместится и на сервере после сохранения правок. */}
                    <td style={td}>
                      <PhotoThumb photo={photosByRow.get(i)} size={40} onOpen={setLightboxPhoto} />
                    </td>
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
                          color: 'var(--danger)',
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
                  <th style={{ ...th, width: 50 }}></th>
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
                    <td style={td}>
                      <PhotoThumb photo={photosByRow.get(i)} size={40} onOpen={setLightboxPhoto} />
                    </td>
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
        const incotermsChanged = incotermsDraft !== (doc.incoterms ?? '');
        const recalculateDisabled =
          recalculating || (!countryChanged && !freightChanged && !incotermsChanged);
        return (
          <div
            style={{
              padding: 16,
              marginBottom: 16,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: doc.countryOriginSource === 'default' ? 'var(--warning-soft)' : 'var(--bg-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15 }}>Параметры расчёта</h3>
              <Link
                href="/reference"
                style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                Что это и на что влияет? &rarr;
              </Link>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <RecalcField label="Страна происхождения" tooltip={COUNTRY_HINT}>
                <select
                  value={countryDraft}
                  onChange={(e) => setCountryDraft(e.target.value)}
                  style={{ ...recalcControl, minWidth: 260 }}
                >
                  <option value="">— не указана —</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.nameRu} ({c.code})
                    </option>
                  ))}
                </select>
              </RecalcField>

              <RecalcField label="Фрахт до границы" tooltip={FREIGHT_HINT}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={freightCostDraft}
                    onChange={(e) => setFreightCostDraft(e.target.value)}
                    style={{ ...recalcControl, width: 140 }}
                  />
                  <select
                    aria-label="Валюта фрахта"
                    value={freightCurrencyDraft}
                    onChange={(e) =>
                      setFreightCurrencyDraft(e.target.value as 'USD' | 'CNY' | 'RUB' | 'EUR')
                    }
                    style={recalcControl}
                  >
                    {(['USD', 'CNY', 'RUB', 'EUR'] as const).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </RecalcField>

              <RecalcField label="Инкотермс" tooltip={INCOTERMS_HINT}>
                <select
                  aria-label="Условия поставки (Инкотермс)"
                  value={incotermsDraft}
                  onChange={(e) => setIncotermsDraft(e.target.value)}
                  style={recalcControl}
                >
                  <option value="">— не указаны —</option>
                  {INCOTERMS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </RecalcField>

              <button
                onClick={handleRecalculate}
                disabled={recalculateDisabled}
                style={{
                  marginLeft: 'auto',
                  padding: '8px 16px',
                  background: recalculateDisabled ? 'var(--text-subtle)' : 'var(--orange)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: recalculateDisabled ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                }}
              >
                {recalculating ? 'Пересчёт...' : 'Пересчитать'}
              </button>
            </div>

            {(doc.countryOriginSource || doc.countryDetectionReason) && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                {doc.countryOriginSource && (
                  <>
                    Источник страны:{' '}
                    <span style={{ color: 'var(--text)' }}>
                      {countryOriginSourceLabels[doc.countryOriginSource]}
                    </span>
                  </>
                )}
                {doc.countryDetectionReason && (
                  <span style={{ fontStyle: 'italic' }}>
                    {doc.countryOriginSource ? ' — ' : ''}
                    {doc.countryDetectionReason}
                  </span>
                )}
              </div>
            )}
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
                <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Валюта:</label>
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
                    border: '1px solid var(--border)',
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
                    photo={photosByRow.get(i)}
                    onOpenPhoto={setLightboxPhoto}
                    originCountry={rowOrigins[i]}
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
        <p style={{ color: 'var(--text-subtle)' }}>Нет данных результата</p>
      )}

      {lightboxPhoto && (
        <PhotoLightbox documentId={doc.id} photo={lightboxPhoto} onClose={closePhoto} />
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
  photo,
  onOpenPhoto,
  originCountry,
}: {
  row: DocumentResultRow;
  index: number;
  isExpanded: boolean;
  onToggle: (index: number) => void;
  fmtMoney: (n: number) => string;
  canEditCode: boolean;
  onSetCode: (rowIndex: number, tnVedCode: string) => Promise<void>;
  explanations: import('@/hooks/use-regulatory-explanations').RegulatoryExplanationsState;
  photo?: DocumentPhotoRow;
  onOpenPhoto: (photo: DocumentPhotoRow) => void;
  originCountry: OriginCountry | null;
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
        style={{ cursor: 'pointer', background: hovered ? 'var(--bg-subtle)' : 'transparent' }}
      >
        <td style={td}>{index + 1}</td>
        <td style={td}>
          <PhotoThumb photo={photo} size={40} onOpen={onOpenPhoto} />
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
              color: 'var(--text-subtle)',
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
          photo={photo}
          onOpenPhoto={onOpenPhoto}
          originCountry={originCountry}
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
  photo,
  onOpenPhoto,
  originCountry,
}: {
  row: DocumentResultRow;
  rowIndex: number;
  fmtMoney: (n: number) => string;
  canEditCode: boolean;
  onSetCode: (rowIndex: number, tnVedCode: string) => Promise<void>;
  explanations: import('@/hooks/use-regulatory-explanations').RegulatoryExplanationsState;
  photo?: DocumentPhotoRow;
  onOpenPhoto: (photo: DocumentPhotoRow) => void;
  originCountry: OriginCountry | null;
}) {
  const notes = row.notes ?? [];
  const sortedNotes = [...notes].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          style={{
            display: 'flex',
            gap: 24,
            padding: '16px 12px',
            background: 'var(--bg-subtle)',
          }}
        >
          {/* Left: image + basic info */}
          <div style={{ flex: '0 0 200px' }}>
            <PhotoThumb photo={photo} size={120} onOpen={onOpenPhoto} />
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
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 0 0',
                marginTop: 4,
                borderTop: '1px solid var(--border)',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <span>Итого</span>
              <span>{fmtMoney(row.totalCost)}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
              Ставка пошлины: {row.dutyRate}% &middot; НДС: {row.vatRate}%
              {row.exciseRate > 0 && <> &middot; Акциз: {row.exciseRate}%</>}
            </div>
          </div>

          {/* Right: notes + formula */}
          <div style={{ flex: 1, minWidth: 200 }}>
            {row.dutyFormula && (
              <div
                style={{
                  background: 'var(--orange-soft)',
                  border: '1px solid var(--orange-soft-border)',
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange-strong)', marginBottom: 4 }}>
                  Формула пошлины
                </div>
                <div style={{ fontSize: 13, fontStyle: 'italic', color: '#8f3f1b' }}>
                  {row.dutyFormula}
                </div>
              </div>
            )}
            {sortedNotes.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
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
                          color: note.severity === 'info' ? 'var(--text-muted)' : cfg.color,
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
                <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Нет замечаний</div>
              )
            )}
          </div>
        </div>
        {canEditCode && (
          <div style={{ padding: '0 12px 16px', background: 'var(--bg-subtle)' }}>
            <ChangeCodeSection
              rowIndex={rowIndex}
              currentCode={row.tnVedCode}
              candidateCodes={row.candidateCodes ?? null}
              onSetCode={onSetCode}
            />
          </div>
        )}
        {row.regulatoryReport ? (
          <div style={{ padding: '0 12px 16px', background: 'var(--bg-subtle)' }}>
            <RegulatoryRequirementsSection
              report={row.regulatoryReport}
              explanations={explanations}
              originCountry={originCountry}
            />
          </div>
        ) : (
          <div style={{ padding: '0 12px 16px', background: 'var(--bg-subtle)', fontSize: 12, color: 'var(--text-subtle)' }}>
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
        border: '1px solid var(--warning-soft-border)',
        background: 'var(--warning-soft)',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning-strong)', marginBottom: 10 }}>
        Изменить код ТН ВЭД
      </div>
      {candidateCodes && candidateCodes.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--warning-strong)', marginBottom: 8 }}>
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
                    border: isCurrent ? '2px solid var(--success)' : '1px solid var(--warning-soft-border)',
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
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      conf {cand.confidence.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.3 }}>
                    {cand.description}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Пошлина {cand.dutyRate}
                    {cand.dutyRateUnit ? ` ${cand.dutyRateUnit}` : '%'}
                    {' · '}НДС {cand.vatRate}%
                    {cand.exciseRate > 0 && ` · Акциз ${cand.exciseRate}%`}
                  </div>
                  {cand.reasoning && (
                    <div style={{ fontSize: 11, color: 'var(--warning-strong)', fontStyle: 'italic' }}>
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
                      background: isCurrent ? 'var(--success-soft)' : 'var(--orange)',
                      color: isCurrent ? 'var(--success-strong)' : '#fff',
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
        <label style={{ fontSize: 12, color: 'var(--warning-strong)' }}>Свой код:</label>
        <input
          type="text"
          value={customCode}
          onChange={(e) => setCustomCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="10 цифр"
          maxLength={10}
          style={{
            padding: '4px 8px',
            border: '1px solid var(--warning-soft-border)',
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
            background: customValid && submitting === null ? 'var(--orange)' : 'var(--text-subtle)',
            color: '#fff',
            fontWeight: 500,
          }}
        >
          {submitting === customCode.trim() ? 'Применяется...' : 'Применить'}
        </button>
        {!candidateCodes?.length && (
          <span style={{ fontSize: 11, color: 'var(--warning-strong)' }}>
            AI не предложил альтернатив — введите код вручную.
          </span>
        )}
      </div>
      {localError && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{localError}</div>
      )}
    </div>
  );
}

function RecalcField({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {label}
        <InfoTooltip text={tooltip} />
      </span>
      {children}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{label}</div>
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
      <span style={{ color: 'var(--text-muted)' }}>
        {label}
        {note && (
          <span style={{ fontSize: 11, color: 'var(--orange-strong)', marginLeft: 4 }}>({note})</span>
        )}
      </span>
      <span>{value}</span>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '2px solid var(--border)',
  whiteSpace: 'nowrap',
};
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' };
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
  border: '1px solid var(--border)',
  borderRadius: 3,
  fontSize: 13,
  boxSizing: 'border-box',
};
const inputNumber: React.CSSProperties = {
  width: 90,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 3,
  fontSize: 13,
  textAlign: 'right',
};
const recalcControl: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: '#fff',
};
