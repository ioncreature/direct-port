'use client';

import { InfoCard } from '@/components/info-card';
import api from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import {
  MANAGER_STATUS_OPTIONS,
  SOURCE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  scoreColor,
} from '@/lib/lead-display';
import { btnDangerOutline, btnOutline, cardSurface } from '@/lib/table-styles';
import type { Lead, LeadStatus } from '@/lib/types';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Lead>(`/leads/${id}`);
      setLead(data);
      setNotesDraft(data.notes ?? '');
    } catch {
      setError('Не удалось загрузить лид');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const { data } = await api.patch<Lead>(`/leads/${id}`, body);
      setLead(data);
      setNotesDraft(data.notes ?? '');
    },
    [id],
  );

  async function changeStatus(status: LeadStatus) {
    setBusy(true);
    setActionError('');
    try {
      await patch({ status });
    } finally {
      setBusy(false);
    }
  }

  async function markContacted() {
    setBusy(true);
    setActionError('');
    try {
      await patch({ markContacted: true });
    } finally {
      setBusy(false);
    }
  }

  async function reenrich() {
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/leads/${id}/reenrich`);
      await load();
    } catch (err: unknown) {
      setActionError(extractApiError(err) ?? 'Не удалось запустить обогащение');
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await patch({ notes: notesDraft });
    } finally {
      setSavingNotes(false);
    }
  }

  async function remove() {
    if (!confirm('Удалить лид безвозвратно?')) return;
    await api.delete(`/leads/${id}`);
    router.push('/leads');
  }

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Загрузка...</p>;
  if (error || !lead) return <p style={{ color: 'var(--danger)' }}>{error || 'Лид не найден'}</p>;

  return (
    <div>
      <Link href="/leads" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 13 }}>
        ← К списку лидов
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '8px 0 20px' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{lead.companyName}</h1>
          {lead.website ? (
            <a href={normalizeHref(lead.website)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              {lead.domain ?? lead.website}
            </a>
          ) : (
            <span style={{ color: 'var(--text-subtle)' }}>сайт не указан</span>
          )}
        </div>
        <button onClick={remove} style={btnDangerOutline}>
          Удалить
        </button>
      </div>

      {/* Действия менеджера */}
      <div
        style={{
          ...cardSurface,
          padding: 14,
          marginBottom: 20,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Статус:</label>
        <select
          value={MANAGER_STATUS_OPTIONS.includes(lead.status) ? lead.status : ''}
          onChange={(e) => e.target.value && changeStatus(e.target.value as LeadStatus)}
          disabled={busy}
          style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
        >
          {!MANAGER_STATUS_OPTIONS.includes(lead.status) && (
            <option value="">{lead.statusLabel}</option>
          )}
          {MANAGER_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button onClick={markContacted} disabled={busy} style={btnOutline}>
          Отметить касание
        </button>
        <button onClick={reenrich} disabled={busy} style={btnOutline}>
          Переобогатить
        </button>
      </div>
      {actionError && <p style={{ color: 'var(--danger)', marginTop: -10, marginBottom: 16 }}>{actionError}</p>}

      {/* Карточки */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <InfoCard label="Статус" value={lead.statusLabel} color={STATUS_COLORS[lead.status]} />
        <InfoCard
          label="Релевантность"
          value={lead.relevanceScore == null ? '—' : lead.relevanceScore.toFixed(2)}
          color={scoreColor(lead.relevanceScore)}
        />
        <InfoCard
          label="Импортёр"
          value={lead.doesImport == null ? '—' : lead.doesImport ? 'да' : 'нет'}
        />
        <InfoCard label="Город" value={lead.city || '—'} />
        <InfoCard label="ИНН" value={lead.inn || '—'} />
        <InfoCard label="Источник" value={SOURCE_LABELS[lead.source]} />
        <InfoCard label="Создан" value={fmtDate(lead.createdAt)} />
        <InfoCard
          label="Последнее касание"
          value={lead.lastContactedAt ? fmtDateTime(lead.lastContactedAt) : '—'}
        />
      </div>

      {lead.errorMessage && (
        <div
          style={{
            ...cardSurface,
            padding: 12,
            marginBottom: 20,
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          Ошибка обогащения: {lead.errorMessage}
        </div>
      )}

      {lead.relevanceReason && (
        <Section title="Почему релевантен">
          <p style={{ margin: 0 }}>{lead.relevanceReason}</p>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <Section title="Телефоны">
          <ContactList items={lead.phones} empty="не найдены" />
        </Section>
        <Section title="Email">
          <ContactList items={lead.emails} empty="не найдены" />
        </Section>
      </div>

      {lead.services && lead.services.length > 0 && (
        <Section title="Услуги">
          <Chips items={lead.services} />
        </Section>
      )}
      {lead.importDirections && lead.importDirections.length > 0 && (
        <Section title="Направления импорта">
          <Chips items={lead.importDirections} />
        </Section>
      )}
      {lead.sourceDetail && (
        <Section title="Источник">
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{lead.sourceDetail}</p>
        </Section>
      )}

      <Section title="Заметки">
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          rows={5}
          placeholder="Заметки по обзвону..."
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            fontSize: 14,
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />
        <button
          onClick={saveNotes}
          disabled={savingNotes || notesDraft === (lead.notes ?? '')}
          style={{ ...btnOutline, marginTop: 8 }}
        >
          {savingNotes ? 'Сохранение...' : 'Сохранить заметки'}
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  );
}

function ContactList({ items, empty }: { items: string[] | null; empty: string }) {
  if (!items || items.length === 0) {
    return <span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{empty}</span>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: 14 }}>
          {it}
        </li>
      ))}
    </ul>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            padding: '3px 10px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--accent-soft)',
            color: 'var(--accent-soft-text)',
            fontSize: 13,
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function normalizeHref(website: string): string {
  return /^https?:\/\//.test(website) ? website : `https://${website}`;
}

function extractApiError(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { message?: string } } }).response;
    if (resp?.data?.message) return resp.data.message;
  }
  return err instanceof Error ? err.message : null;
}
