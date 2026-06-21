'use client';

import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useLeads, type ImportItem } from '@/hooks/use-leads';
import api from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { SOURCE_LABELS, STATUS_COLORS, scoreColor } from '@/lib/lead-display';
import {
  btnOutline,
  btnPrimary,
  cardSurface,
  filterChip,
  td,
  tdEmpty,
  th,
  thR,
} from '@/lib/table-styles';
import type { Lead, LeadSource, LeadStatus } from '@/lib/types';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

const STATUS_FILTERS: { value: LeadStatus | ''; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'enriched', label: 'Обогащены' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'contacted', label: 'Связались' },
  { value: 'qualified', label: 'Квалифицированы' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'failed', label: 'Ошибка' },
];

const SCORE_FILTERS: { value: number | ''; label: string }[] = [
  { value: '', label: 'Любой скор' },
  { value: 0.4, label: '0.4+' },
  { value: 0.7, label: '0.7+' },
];

function parseImportText(text: string): ImportItem[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [companyName, website, inn, city] = line.split(/[\t;,]/).map((p) => p.trim());
      return { companyName, website: website || undefined, inn: inn || undefined, city: city || undefined };
    })
    .filter((i) => i.companyName);
}

export default function LeadsPage() {
  const lead = useLeads();
  const [panel, setPanel] = useState<'discover' | 'import' | null>(null);
  const [notice, setNotice] = useState('');
  const [searchDraft, setSearchDraft] = useState('');

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
        <h1>Лиды</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPanel(panel === 'discover' ? null : 'discover')}
            style={btnPrimary}
          >
            Найти в вебе
          </button>
          <button onClick={() => setPanel(panel === 'import' ? null : 'import')} style={btnOutline}>
            Импорт
          </button>
          <button onClick={() => exportCsv(lead)} style={btnOutline}>
            Экспорт CSV
          </button>
          <button onClick={lead.refetch} style={btnOutline}>
            Обновить
          </button>
        </div>
      </div>

      {notice && (
        <div
          style={{
            ...cardSurface,
            padding: '10px 14px',
            marginBottom: 16,
            color: 'var(--accent-soft-text)',
            background: 'var(--accent-soft)',
          }}
        >
          {notice}
        </div>
      )}

      {panel === 'discover' && (
        <DiscoverPanel
          onClose={() => setPanel(null)}
          onSubmitted={(q) => {
            setNotice(`Поиск «${q}» запущен. Лиды появятся через 1–2 минуты — нажмите «Обновить».`);
            setPanel(null);
          }}
          discover={lead.discover}
        />
      )}

      {panel === 'import' && (
        <ImportPanel
          onClose={() => setPanel(null)}
          onImported={(res) => {
            setNotice(`Импортировано: создано ${res.created}, пропущено дублей ${res.skipped}.`);
            setPanel(null);
          }}
          importLeads={lead.importLeads}
        />
      )}

      {/* Фильтры */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => lead.setStatusFilter(f.value)}
            style={filterChip(lead.status === f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        {SCORE_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => lead.setMinScoreFilter(f.value)}
            style={filterChip(lead.minScore === f.value)}
          >
            {f.label}
          </button>
        ))}
        <select
          value={lead.source}
          onChange={(e) => lead.setSourceFilter(e.target.value as LeadSource | '')}
          style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
        >
          <option value="">Все источники</option>
          {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lead.setSearchFilter(searchDraft.trim());
          }}
          style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}
        >
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Название / город / домен"
            style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', width: 240 }}
          />
          <button type="submit" style={btnOutline}>
            Найти
          </button>
        </form>
      </div>

      {lead.loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortableTh field="companyName" label="Компания" sortBy={lead.sortBy} sortOrder={lead.sortOrder} onToggle={lead.toggleSort} />
                <th style={th}>Статус</th>
                <SortableTh field="relevanceScore" label="Скор" sortBy={lead.sortBy} sortOrder={lead.sortOrder} onToggle={lead.toggleSort} style={thR} />
                <th style={th}>Контакты</th>
                <th style={th}>Источник</th>
                <SortableTh field="createdAt" label="Создан" sortBy={lead.sortBy} sortOrder={lead.sortOrder} onToggle={lead.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {lead.leads.map((l) => (
                <LeadRow key={l.id} lead={l} />
              ))}
              {lead.leads.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={6}>
                    Лидов пока нет. Запустите «Найти в вебе» или импортируйте список.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager page={lead.page} total={lead.total} limit={lead.limit} onPageChange={lead.setPage} />
        </>
      )}
    </div>
  );
}

function LeadRow({ lead: l }: { lead: Lead }) {
  const contact = l.phones?.[0] || l.emails?.[0] || '—';
  return (
    <tr>
      <td style={td}>
        <Link href={`/leads/${l.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
          {l.companyName}
        </Link>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {[l.city, l.domain].filter(Boolean).join(' · ') || '—'}
        </div>
      </td>
      <td style={td}>
        <span style={{ color: STATUS_COLORS[l.status], fontWeight: 600, fontSize: 13 }}>
          {l.statusLabel}
        </span>
      </td>
      <td style={{ ...td, textAlign: 'right', color: scoreColor(l.relevanceScore), fontWeight: 600 }}>
        {l.relevanceScore == null ? '—' : l.relevanceScore.toFixed(2)}
      </td>
      <td style={{ ...td, fontSize: 13 }}>{contact}</td>
      <td style={{ ...td, fontSize: 13, color: 'var(--text-muted)' }}>{SOURCE_LABELS[l.source]}</td>
      <td style={{ ...td, fontSize: 13, color: 'var(--text-muted)' }}>{fmtDate(l.createdAt)}</td>
    </tr>
  );
}

function DiscoverPanel({
  onClose,
  onSubmitted,
  discover,
}: {
  onClose: () => void;
  onSubmitted: (query: string) => void;
  discover: ReturnType<typeof useLeads>['discover'];
}) {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [maxResults, setMaxResults] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await discover({ query: query.trim(), city: city.trim() || undefined, maxResults: Number(maxResults) || 10 });
      onSubmitted(query.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось запустить поиск');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...cardSurface, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Запрос (ниша + город)" style={{ flex: 2, minWidth: 280 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
            minLength={3}
            placeholder="таможенное оформление импорт Владивосток"
            style={inputStyle}
          />
        </Field>
        <Field label="Город (опц.)" style={{ flex: 1, minWidth: 140 }}>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Владивосток" style={inputStyle} />
        </Field>
        <Field label="Сколько" style={{ width: 90 }}>
          <input
            type="number"
            min={1}
            max={30}
            value={maxResults}
            onChange={(e) => setMaxResults(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <button type="submit" disabled={busy || query.trim().length < 3} style={btnPrimary}>
          {busy ? 'Запуск...' : 'Запустить поиск'}
        </button>
        <button type="button" onClick={onClose} style={btnOutline}>
          Отмена
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', marginTop: 10, marginBottom: 0 }}>{error}</p>}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
        Claude найдёт компании через веб-поиск и поставит их на обогащение. Результаты появятся в списке через 1–2 минуты.
      </p>
    </form>
  );
}

function ImportPanel({
  onClose,
  onImported,
  importLeads,
}: {
  onClose: () => void;
  onImported: (res: { created: number; skipped: number }) => void;
  importLeads: ReturnType<typeof useLeads>['importLeads'];
}) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<LeadSource>('fts_registry');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const items = parseImportText(text);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) {
      setError('Не распознано ни одной строки');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await importLeads(items, { source });
      onImported(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...cardSurface, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        По строке на компанию: <code>Название; сайт; ИНН; город</code> (разделитель — табуляция, <code>;</code> или
        <code>,</code>). Можно вставить колонки из Excel.
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'ООО Импорт-Логистик; import-log.ru; 7701234567; Москва\nВЭД-Сервис; ved-service.ru'}
        style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} style={inputStyle}>
          {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Распознано строк: {items.length}</span>
        <button type="submit" disabled={busy || items.length === 0} style={{ ...btnPrimary, marginLeft: 'auto' }}>
          {busy ? 'Импорт...' : `Импортировать (${items.length})`}
        </button>
        <button type="button" onClick={onClose} style={btnOutline}>
          Отмена
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', marginTop: 10, marginBottom: 0 }}>{error}</p>}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  fontSize: 14,
  boxSizing: 'border-box',
};

function Field({
  label,
  style,
  children,
}: {
  label: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div style={style}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

async function exportCsv(lead: ReturnType<typeof useLeads>): Promise<void> {
  const params: Record<string, string | number> = {};
  if (lead.status) params.status = lead.status;
  if (lead.source) params.source = lead.source;
  if (lead.minScore !== '') params.minScore = lead.minScore;
  if (lead.search) params.search = lead.search;
  const res = await api.get('/leads/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leads.csv';
  a.click();
  URL.revokeObjectURL(url);
}
