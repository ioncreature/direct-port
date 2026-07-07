'use client';

import { BotLinksSection } from '@/components/bot-links-section';
import { CompanySelect } from '@/components/company-select';
import { useAuth } from '@/hooks/use-auth';
import { useDashboardStats } from '@/hooks/use-dashboard-stats';
import { statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, fmtCost, niceCeil } from '@/lib/format';
import { isAdminRole, isSuperAdmin } from '@/lib/roles';
import { btnOutline, cardSurface, statValue } from '@/lib/table-styles';
import type { DashboardPeriod, DashboardSeriesPoint } from '@/lib/types';
import Link from 'next/link';
import { useState } from 'react';

const periodOptions: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
  { value: 'year', label: 'Год' },
];

const periodSuffix: Record<DashboardPeriod, string> = {
  week: 'за 7 дней',
  month: 'за 30 дней',
  year: 'за год',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);
  const superAdmin = isSuperAdmin(user?.role);
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [companyFilter, setCompanyFilter] = useState('');
  const { stats, loading } = useDashboardStats(period, superAdmin ? companyFilter : '');

  if (loading && !stats) return <p>Загрузка...</p>;
  if (!stats) return <p>Не удалось загрузить статистику</p>;

  const byStatus = stats.documents.byStatus;
  const inWork =
    (byStatus.intake ?? 0) +
    (byStatus.parsing ?? 0) +
    (byStatus.pending ?? 0) +
    (byStatus.processing ?? 0);
  const review = (byStatus.requires_review ?? 0) + (byStatus.code_review_required ?? 0);
  const partialDocs = byStatus.processed_with_errors ?? 0;
  const failedDocs = byStatus.failed ?? 0;
  const aiCost = stats.ai ? calcAiCostFromMap(stats.ai.models) : null;
  const leadCost = stats.ai?.leads ? calcAiCostFromMap(stats.ai.leads) : null;
  const quality = stats.quality;
  const suffix = periodSuffix[period];
  const fade: React.CSSProperties = { opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' };

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}
      >
        <h1 style={{ margin: 0 }}>Дашборд</h1>
        {superAdmin && <CompanySelect value={companyFilter} onChange={setCompanyFilter} />}
        <div style={{ display: 'flex', gap: 6 }}>
          {periodOptions.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                ...btnOutline,
                fontWeight: period === p.value ? 700 : 400,
                borderColor: period === p.value ? 'var(--ink)' : 'var(--border)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <SectionTitle>Документы и позиции {suffix}</SectionTitle>
      <div style={{ ...cardsGrid, ...fade }}>
        <StatCard
          label="Загружено документов"
          value={fmtInt(stats.documents.total)}
          href="/documents"
          sub={joinDot([
            inWork > 0 && <>в работе: {fmtInt(inWork)}</>,
            review > 0 && (
              <span style={{ color: 'var(--warning-strong)' }}>на проверке: {fmtInt(review)}</span>
            ),
          ])}
        />
        <StatCard
          label="Успешно обработано"
          value={fmtInt(byStatus.processed ?? 0)}
          color={(byStatus.processed ?? 0) > 0 ? 'var(--success)' : undefined}
          sub={joinDot([
            partialDocs > 0 && (
              <span style={{ color: 'var(--warning-strong)' }}>частично: {fmtInt(partialDocs)}</span>
            ),
            failedDocs > 0 && <span style={{ color: 'var(--danger)' }}>сбои: {fmtInt(failedDocs)}</span>,
          ])}
        />
        <StatCard
          label="Обработано позиций"
          value={fmtInt(stats.positions.total)}
          sub={`успешно рассчитано: ${fmtInt(stats.positions.successful)}`}
        />
        {isAdmin && aiCost != null && (
          <StatCard label="AI-расходы" value={fmtCost(aiCost)} href="/ai-costs" color="var(--violet)" />
        )}
        {isAdmin && leadCost != null && (
          <StatCard label="Поиск лидов" value={fmtCost(leadCost)} href="/ai-costs" color="var(--violet)" />
        )}
      </div>

      {stats.series.length > 1 && (
        <div style={{ marginBottom: 32, ...fade }}>
          <SeriesChart data={stats.series} granularity={stats.granularity} />
        </div>
      )}

      {quality != null && quality.exact + quality.review > 0 && (
        <>
          <SectionTitle>Качество классификации {suffix}</SectionTitle>
          <div style={{ ...cardsGrid, ...fade }}>
            <StatCard
              label="Точные коды"
              value={`${Math.round((quality.exact / (quality.exact + quality.review)) * 100)}%`}
              color="var(--success)"
              sub={`${fmtInt(quality.exact)} из ${fmtInt(quality.exact + quality.review)} строк`}
            />
            <StatCard
              label="Требуют проверки"
              value={fmtInt(quality.review)}
              color={quality.review > 0 ? 'var(--warning-strong)' : undefined}
              sub={joinDot([
                <>строк с неуверенным кодом</>,
                quality.manualCodes > 0 && <>вручную: {fmtInt(quality.manualCodes)}</>,
              ])}
            />
            <StatCard
              label="Из каталога клиента"
              value={fmtInt(quality.fromCatalog)}
              sub="строк без AI — код подтверждён ранее"
            />
            {quality.avgMatchConfidence != null && (
              <StatCard
                label="Средняя уверенность"
                value={quality.avgMatchConfidence.toFixed(2)}
                sub="по строкам с кодом ТН ВЭД"
              />
            )}
          </div>
        </>
      )}

      <SectionTitle>Клиенты и баланс</SectionTitle>
      <div style={{ ...cardsGrid, ...fade }}>
        <StatCard
          label="Активные клиенты"
          value={fmtInt(stats.clients.active)}
          sub={`с документами ${suffix} · новых: ${fmtInt(stats.clients.new)} · всего: ${fmtInt(stats.clients.total)}`}
          href="/telegram-users"
        />
        <StatCard
          label="Баланс клиентов"
          value={fmtInt(stats.billing.totalBalance)}
          sub="позиций на депозитах сейчас"
        />
        <StatCard
          label="Пополнения"
          value={`+${fmtInt(stats.billing.topUpPositions)}`}
          sub={`позиций ${suffix}`}
          color={stats.billing.topUpPositions > 0 ? 'var(--success)' : undefined}
        />
        <StatCard
          label="Списания"
          value={`−${fmtInt(stats.billing.chargedPositions)}`}
          sub={`позиций за обработку ${suffix}`}
        />
        {isAdmin && stats.users != null && (
          <StatCard label="Пользователи" value={fmtInt(stats.users)} href="/users" />
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 24,
          ...fade,
        }}
      >
        <div>
          <h3 style={{ marginBottom: 12 }}>Последние документы</h3>
          <div className="dp-card-hover" style={{ ...cardSurface, padding: '8px 18px' }}>
            {stats.recentDocuments.length === 0 && (
              <p style={{ color: 'var(--text-subtle)' }}>Документов пока нет</p>
            )}
            {stats.recentDocuments.map((doc, i) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '9px 0',
                  borderBottom:
                    i < stats.recentDocuments.length - 1
                      ? '1px solid var(--border-subtle)'
                      : undefined,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.originalFileName}
                </span>
                <span
                  style={{
                    color: statusColors[doc.status],
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusLabels[doc.status]}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <BotLinksSection companyId={superAdmin ? companyFilter : undefined} />
      </div>
    </div>
  );
}

const cardsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 16,
  marginBottom: 28,
};

function fmtInt(n: number): string {
  return n.toLocaleString('ru');
}

/** Склеивает непустые части подписи карточки разделителем « · ». undefined — если частей нет. */
function joinDot(parts: React.ReactNode[]): React.ReactNode {
  const shown = parts.filter(Boolean);
  if (shown.length === 0) return undefined;
  return shown.map((part, i) => (
    <span key={i}>
      {i > 0 && ' · '}
      {part}
    </span>
  ));
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: '0 0 12px' }}>{children}</h3>;
}

function StatCard({
  label,
  value,
  sub,
  href,
  color,
}: {
  label: string;
  value: number | string;
  sub?: React.ReactNode;
  href?: string;
  color?: string;
}) {
  const content = (
    <div
      className="dp-card-hover"
      style={{ ...cardSurface, padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}
    >
      <div style={{ ...statValue, letterSpacing: '-0.02em', color: color || 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginTop: 4 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}
      >
        {content}
      </Link>
    );
  }
  return content;
}

/** Высоты полос графика: основная — позиции, компактная — документы. */
const POSITIONS_BAND_PX = 104;
const DOCUMENTS_BAND_PX = 44;

/* Цвета серий: две светлоты фирменного петроля. Серии живут в отдельных
   подписанных полосах, поэтому идентичность несут подписи, а не оттенок. */
const SERIES_COLORS = {
  positions: { base: '#4d949e', active: '#3a7a83' },
  documents: { base: 'var(--petrol)', active: '#0b535e' },
} as const;

/**
 * Обработка по дням (неделя/месяц) или месяцам (год): две синхронные полосы
 * баров с общей осью X — позиции и документы, у каждой своя шкала.
 * Общий hover: наведение в любой полосе подсвечивает всю колонку даты.
 */
function SeriesChart({
  data,
  granularity,
}: {
  data: DashboardSeriesPoint[];
  granularity: 'day' | 'month';
}) {
  const positionsMax = niceCeil(Math.max(...data.map((d) => d.positions), 0));
  const documentsMax = niceCeil(Math.max(...data.map((d) => d.documents), 0));
  const totalPositions = data.reduce((s, d) => s + d.positions, 0);
  const totalDocs = data.reduce((s, d) => s + d.documents, 0);
  const currentKey = new Date().toISOString().slice(0, granularity === 'day' ? 10 : 7);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // Для года метка — целиком YYYY-MM, для дней достаточно MM-DD.
  const shortLabel = (date: string) => (granularity === 'day' ? date.slice(5) : date);

  const band = (
    series: 'positions' | 'documents',
    axisMax: number,
    bandHeight: number,
    withTooltip: boolean,
  ) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        height: bandHeight,
        position: 'relative',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {data.map((d, i) => {
        const value = d[series];
        const heightPx = value > 0 ? Math.max((value / axisMax) * bandHeight, 2) : 0;
        const colors = SERIES_COLORS[series];
        const isActive = activeIdx === i;
        return (
          <div
            key={d.date}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              alignSelf: 'stretch',
              position: 'relative',
              cursor: 'pointer',
              background: isActive ? 'var(--bg-subtle)' : undefined,
            }}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => setActiveIdx((prev) => (prev === i ? null : i))}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 24,
                height: heightPx,
                background: d.date === currentKey
                  ? 'var(--orange)'
                  : isActive
                    ? colors.active
                    : colors.base,
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s, background 0.15s',
              }}
            />
            {withTooltip && isActive && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--ink)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 10,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              >
                <div style={{ fontWeight: 600 }}>{d.date}</div>
                <div style={{ marginTop: 2 }}>{fmtInt(d.positions)} позиций</div>
                <div style={{ marginTop: 2, color: '#b3c0c8' }}>
                  документов: {fmtInt(d.documents)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const bandLabel = (text: string, scaleMax: number, marginTop: number) => (
    <div style={{ fontSize: 11, color: 'var(--text-subtle)', margin: `${marginTop}px 0 4px` }}>
      {text} <span>· 0–{fmtInt(scaleMax)}</span>
    </div>
  );

  return (
    <div className="dp-card-hover" style={{ ...cardSurface, padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        <span>Обработка {granularity === 'day' ? 'по дням' : 'по месяцам'}</span>
        <span style={{ fontWeight: 600 }}>
          Итого: {fmtInt(totalPositions)} поз. · {fmtInt(totalDocs)} док.
        </span>
      </div>
      <div onMouseLeave={() => setActiveIdx(null)}>
        {bandLabel('Позиции', positionsMax, 0)}
        {band('positions', positionsMax, POSITIONS_BAND_PX, true)}
        {bandLabel('Документы', documentsMax, 10)}
        {band('documents', documentsMax, DOCUMENTS_BAND_PX, false)}
      </div>
      {data.length <= 14 ? (
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          {data.map((d) => (
            <div
              key={d.date}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 10,
                color: 'var(--text-subtle)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {shortLabel(d.date)}
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--text-subtle)',
            marginTop: 4,
          }}
        >
          <span>{shortLabel(data[0]?.date ?? '')}</span>
          <span>{shortLabel(data[data.length - 1]?.date ?? '')}</span>
        </div>
      )}
    </div>
  );
}
