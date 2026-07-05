'use client';

import { BotLinksSection } from '@/components/bot-links-section';
import { CompanySelect } from '@/components/company-select';
import { useAuth } from '@/hooks/use-auth';
import { useDashboardStats } from '@/hooks/use-dashboard-stats';
import { statusColors, statusLabels } from '@/lib/documents';
import { calcAiCostFromMap, fmtCost, niceCeil } from '@/lib/format';
import { isAdminRole, isSuperAdmin } from '@/lib/roles';
import { btnOutline, cardSurface, CHART_HEIGHT_PX } from '@/lib/table-styles';
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
  const aiCost = stats.ai ? calcAiCostFromMap(stats.ai.models) : null;
  const leadCost = stats.ai?.leads ? calcAiCostFromMap(stats.ai.leads) : null;
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

      <SectionTitle>Документы {suffix}</SectionTitle>
      <div style={{ ...cardsGrid, ...fade }}>
        <StatCard label="Загружено" value={fmtInt(stats.documents.total)} href="/documents" />
        <StatCard
          label="Обработано"
          value={fmtInt(byStatus.processed ?? 0)}
          color="var(--success)"
        />
        <StatCard
          label="Частично"
          value={fmtInt(byStatus.processed_with_errors ?? 0)}
          color="var(--warning)"
        />
        <StatCard label="Сбои" value={fmtInt(byStatus.failed ?? 0)} color="var(--danger)" />
        <StatCard label="В работе" value={fmtInt(inWork)} />
        <StatCard
          label="На проверке"
          value={fmtInt(review)}
          color={review > 0 ? 'var(--warning)' : undefined}
        />
      </div>

      <SectionTitle>Позиции {suffix}</SectionTitle>
      <div style={{ ...cardsGrid, ...fade }}>
        <StatCard
          label="Обработано позиций"
          value={fmtInt(stats.positions.total)}
          sub={`успешно рассчитано: ${fmtInt(stats.positions.successful)}`}
          color="var(--success)"
        />
        <StatCard
          label="Таможенные платежи"
          value={fmtRub(stats.positions.customsPaymentsRub)}
          sub="пошлина + НДС + акциз"
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

      <SectionTitle>Клиенты и баланс</SectionTitle>
      <div style={{ ...cardsGrid, ...fade }}>
        <StatCard
          label="Клиенты"
          value={fmtInt(stats.clients.total)}
          sub={`новых ${suffix}: ${fmtInt(stats.clients.new)}`}
          href="/telegram-users"
        />
        <StatCard
          label="Активные клиенты"
          value={fmtInt(stats.clients.active)}
          sub={`с документами ${suffix}`}
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
          color="var(--success)"
        />
        <StatCard
          label="Списания"
          value={`−${fmtInt(stats.billing.chargedPositions)}`}
          sub={`позиций за обработку ${suffix}`}
        />
        <StatCard
          label="Заявки на пополнение"
          value={fmtInt(stats.billing.pendingTopUps)}
          sub="ожидают подтверждения"
          color={stats.billing.pendingTopUps > 0 ? 'var(--warning)' : undefined}
        />
        {isAdmin && stats.users != null && (
          <StatCard label="Пользователи" value={fmtInt(stats.users)} href="/users" />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, ...fade }}>
        <div>
          <h3 style={{ marginBottom: 12 }}>Последние документы</h3>
          <div style={{ ...cardSurface, padding: '8px 18px' }}>
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

        <BotLinksSection />
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

/** Компактные рубли для карточки: большие суммы — в млн/млрд, иначе целыми. */
function fmtRub(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('ru', { maximumFractionDigits: 1 })} млрд ₽`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('ru', { maximumFractionDigits: 1 })} млн ₽`;
  return `${Math.round(v).toLocaleString('ru')} ₽`;
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
  sub?: string;
  href?: string;
  color?: string;
}) {
  const content = (
    <div
      className={href ? 'dp-card-hover' : undefined}
      style={{ ...cardSurface, padding: 20, height: '100%', boxSizing: 'border-box' }}
    >
      <div
        style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: color || 'var(--text)' }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginTop: 6 }}>
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

/** Бары обработанных позиций по дням (неделя/месяц) или месяцам (год). */
function SeriesChart({
  data,
  granularity,
}: {
  data: DashboardSeriesPoint[];
  granularity: 'day' | 'month';
}) {
  const axisMax = niceCeil(Math.max(...data.map((d) => d.positions), 0));
  const totalPositions = data.reduce((s, d) => s + d.positions, 0);
  const totalDocs = data.reduce((s, d) => s + d.documents, 0);
  const currentKey = new Date().toISOString().slice(0, granularity === 'day' ? 10 : 7);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // Для года метка — целиком YYYY-MM, для дней достаточно MM-DD.
  const shortLabel = (date: string) => (granularity === 'day' ? date.slice(5) : date);

  return (
    <div style={{ ...cardSurface, padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 12,
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          Обработанные позиции {granularity === 'day' ? 'по дням' : 'по месяцам'}{' '}
          <span style={{ color: 'var(--text-subtle)' }}>· шкала 0 – {fmtInt(axisMax)}</span>
        </span>
        <span style={{ fontWeight: 600 }}>
          Итого: {fmtInt(totalPositions)} поз. · {fmtInt(totalDocs)} док.
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height: CHART_HEIGHT_PX,
          position: 'relative',
        }}
        onMouseLeave={() => setActiveIdx(null)}
      >
        {data.map((d, i) => {
          // Высота в px: проценты от неопределённой высоты parent давали 0.
          const heightPx = d.positions > 0 ? Math.max((d.positions / axisMax) * CHART_HEIGHT_PX, 2) : 0;
          const isCurrent = d.date === currentKey;
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
              }}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => setActiveIdx((prev) => (prev === i ? null : i))}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 24,
                  height: heightPx,
                  background: isCurrent
                    ? 'var(--orange)'
                    : isActive
                      ? '#4d949e'
                      : 'var(--petrol-light)',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s, background 0.15s',
                }}
              />
              {isActive && (
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
