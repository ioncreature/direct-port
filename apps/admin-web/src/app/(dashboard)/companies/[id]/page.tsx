'use client';

import { CompanyBotsPanel } from '@/components/company-bots-panel';
import { CompanyAssetPanel } from '@/components/company-asset-panel';
import { InfoCard } from '@/components/info-card';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useCompany } from '@/hooks/use-company';
import type { CompanyUpdatePayload } from '@/hooks/use-companies';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { extractApiError } from '@/lib/api-error';
import { THEME_OPTIONS } from '@/lib/companies';
import { fmtDate } from '@/lib/format';
import { roleLabel } from '@/lib/roles';
import { btnDanger, btnPrimary, cardSurface, td, tdEmpty, th } from '@/lib/table-styles';
import { getTelegramName } from '@/lib/telegram';
import type {
  CompanyCounts,
  CompanyDetail,
  CompanyTheme,
  TelegramUser,
  User,
} from '@/lib/types';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const linkStyle: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none' };
const inputStyle: React.CSSProperties = { width: '100%', padding: 8, boxSizing: 'border-box' };

export default function CompanyDetailPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { company, loading, error, update, remove, refetch } = useCompany(id);

  if (user && user.role !== 'super_admin') {
    return <p>Недостаточно прав для просмотра этого раздела.</p>;
  }
  if (loading) return <p>Загрузка...</p>;
  if (error || !company) {
    return <p style={{ color: 'var(--danger)' }}>{error || 'Компания не найдена'}</p>;
  }

  async function handleDelete() {
    await remove();
    router.push('/companies');
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Link href="/companies" style={{ ...linkStyle, fontSize: 14 }}>
          &larr; Назад к компаниям
        </Link>
      </div>

      <h1 style={{ marginBottom: 20 }}>{company.name}</h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <InfoCard label="Пользователи" value={String(company.counts.users)} />
        <InfoCard label="Клиенты" value={String(company.counts.clients)} />
        <InfoCard label="Документы" value={String(company.counts.documents)} />
        <InfoCard label="Создана" value={fmtDate(company.createdAt)} />
      </div>

      <SettingsForm company={company} onSave={update} />

      <SectionTitle>Брендинг</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CompanyAssetPanel
          companyId={company.id}
          asset="logo"
          title="Логотип компании"
          hint="PNG, JPEG, WebP или SVG, до 2 МБ. Заменяет марку DirectPort в шапке и на странице входа для этого тенанта."
          hash={company.logoHash}
          onChange={refetch}
        />
        <CompanyAssetPanel
          companyId={company.id}
          asset="favicon"
          title="Favicon"
          hint="Иконка вкладки браузера, желательно квадратная. PNG, JPEG, WebP или SVG, до 2 МБ. Заменяет иконку DirectPort в браузере для этого тенанта."
          hash={company.faviconHash}
          onChange={refetch}
        />
      </div>

      <SectionTitle>Telegram-боты</SectionTitle>
      <CompanyBotsPanel companyId={company.id} />

      <SectionTitle>Пользователи</SectionTitle>
      <CompanyUsersTable companyId={company.id} />

      <SectionTitle>Клиенты</SectionTitle>
      <CompanyClientsTable companyId={company.id} />

      <DangerZone company={company} onDelete={handleDelete} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 600, margin: '36px 0 14px' }}>{children}</h2>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>{hint}</p>}
    </div>
  );
}

/** Настройки компании: название, slug кабинета, тема, домены. Шлёт только изменённые поля. */
function SettingsForm({
  company,
  onSave,
}: {
  company: CompanyDetail;
  onSave: (payload: CompanyUpdatePayload) => Promise<void>;
}) {
  const [name, setName] = useState(company.name);
  const [slug, setSlug] = useState(company.slug ?? '');
  const [theme, setTheme] = useState<CompanyTheme>(company.theme);
  const [domainsText, setDomainsText] = useState(company.domains.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // После сохранения хук перезагружает компанию (slug/домены приходят нормализованными) —
  // пересинхронизируем поля с актуальным состоянием.
  useEffect(() => {
    setName(company.name);
    setSlug(company.slug ?? '');
    setTheme(company.theme);
    setDomainsText(company.domains.join('\n'));
  }, [company]);

  const domains = domainsText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Реконсиляция доменов на бэке — полный delete+insert, поэтому шлём их только при реальном
  // изменении набора (сравниваем отсортированные копии; бэк отдаёт домены уже отсортированными).
  const payload: CompanyUpdatePayload = {};
  if (name.trim() !== company.name) payload.name = name.trim();
  if (slug.trim() !== (company.slug ?? '')) payload.slug = slug.trim();
  if (theme !== company.theme) payload.theme = theme;
  if (JSON.stringify([...domains].sort()) !== JSON.stringify([...company.domains].sort())) {
    payload.domains = domains;
  }
  const dirty = Object.keys(payload).length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Название не может быть пустым');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await onSave(payload);
      setSaved(true);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ ...cardSurface, padding: 20, marginTop: 20, maxWidth: 640 }}>
      <Field label="Название">
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Slug кабинета" hint="lowercase, цифры, дефисы. Пусто — снять slug.">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="нет"
          style={inputStyle}
        />
      </Field>
      <Field label="Тема оформления">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as CompanyTheme)}
          style={inputStyle}
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Домены тенанта"
        hint="По одному в строке или через запятую. По ним резолвится тема и гейт входа в админку."
      >
        <textarea
          value={domainsText}
          onChange={(e) => setDomainsText(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 13, resize: 'vertical' }}
        />
      </Field>
      {error && <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="submit"
          disabled={saving || !dirty}
          style={{ ...btnPrimary, opacity: saving || !dirty ? 0.5 : 1, cursor: saving || !dirty ? 'default' : 'pointer' }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        {saved && !dirty && <span style={{ color: 'var(--success)', fontSize: 14 }}>Сохранено</span>}
      </div>
    </form>
  );
}

function CompanyUsersTable({ companyId }: { companyId: string }) {
  const extraParams = useMemo(() => ({ companyId }), [companyId]);
  const list = useServerPaginatedList<User>('/users', { extraParams, defaultSortBy: 'createdAt' });

  if (list.loading) return <p>Загрузка...</p>;

  return (
    <>
      <table style={tableStyle}>
        <thead>
          <tr>
            <SortableTh field="email" label="Email" sortBy={list.sortBy} sortOrder={list.sortOrder} onToggle={list.toggleSort} />
            <SortableTh field="role" label="Роль" sortBy={list.sortBy} sortOrder={list.sortOrder} onToggle={list.toggleSort} />
            <th style={th}>Активен</th>
            <SortableTh field="createdAt" label="Создан" sortBy={list.sortBy} sortOrder={list.sortOrder} onToggle={list.toggleSort} />
          </tr>
        </thead>
        <tbody>
          {list.items.map((u) => (
            <tr key={u.id}>
              <td style={td}>
                <Link href={`/users/${u.id}/edit`} style={linkStyle}>
                  {u.email}
                </Link>
              </td>
              <td style={td}>{roleLabel(u.role)}</td>
              <td style={td}>{u.isActive ? 'да' : 'нет'}</td>
              <td style={td}>{fmtDate(u.createdAt)}</td>
            </tr>
          ))}
          {list.items.length === 0 && (
            <tr>
              <td style={tdEmpty} colSpan={4}>
                В компании нет пользователей
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager page={list.page} total={list.total} limit={list.limit} onPageChange={list.setPage} />
    </>
  );
}

function CompanyClientsTable({ companyId }: { companyId: string }) {
  const extraParams = useMemo(() => ({ companyId }), [companyId]);
  const list = useServerPaginatedList<TelegramUser>('/telegram-users', {
    extraParams,
    defaultSortBy: 'createdAt',
  });

  if (list.loading) return <p>Загрузка...</p>;

  return (
    <>
      <table style={tableStyle}>
        <thead>
          <tr>
            <SortableTh field="username" label="Клиент" sortBy={list.sortBy} sortOrder={list.sortOrder} onToggle={list.toggleSort} />
            <th style={th}>Telegram ID</th>
            <th style={th}>Документов</th>
            <SortableTh field="createdAt" label="Регистрация" sortBy={list.sortBy} sortOrder={list.sortOrder} onToggle={list.toggleSort} />
          </tr>
        </thead>
        <tbody>
          {list.items.map((c) => (
            <tr key={c.id}>
              <td style={td}>
                <Link href={`/telegram-users/${c.id}`} style={linkStyle}>
                  {getTelegramName(c)}
                </Link>
              </td>
              <td style={td}>{c.telegramId}</td>
              <td style={td}>{c.documentCount ?? 0}</td>
              <td style={td}>{fmtDate(c.createdAt)}</td>
            </tr>
          ))}
          {list.items.length === 0 && (
            <tr>
              <td style={tdEmpty} colSpan={4}>
                В компании нет клиентов
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager page={list.page} total={list.total} limit={list.limit} onPageChange={list.setPage} />
    </>
  );
}

function describeBlockers(counts: CompanyCounts): string {
  const parts: string[] = [];
  if (counts.users) parts.push(`пользователи (${counts.users})`);
  if (counts.clients) parts.push(`клиенты (${counts.clients})`);
  if (counts.documents) parts.push(`документы (${counts.documents})`);
  return parts.join(', ');
}

/** Удаление компании — только если она пуста (нет пользователей/клиентов/документов). */
function DangerZone({
  company,
  onDelete,
}: {
  company: CompanyDetail;
  onDelete: () => Promise<void>;
}) {
  const { users, clients, documents } = company.counts;
  const blocked = users + clients + documents > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    if (!confirm(`Удалить компанию «${company.name}»? Действие необратимо.`)) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (err) {
      setError(extractApiError(err));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 44,
        border: '1px solid var(--danger)',
        borderRadius: 'var(--radius)',
        padding: 20,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--danger)', margin: '0 0 8px' }}>
        Удаление компании
      </h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 14 }}>
        {blocked
          ? `Удаление недоступно: к компании привязаны ${describeBlockers(company.counts)}. Перенесите или удалите их, чтобы освободить компанию.`
          : 'Компания пуста — её можно удалить. Домены снимутся автоматически.'}
      </p>
      <button
        onClick={handleClick}
        disabled={blocked || busy}
        style={{
          ...btnDanger,
          opacity: blocked || busy ? 0.5 : 1,
          cursor: blocked || busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Удаление...' : 'Удалить компанию'}
      </button>
      {error && <p style={{ color: 'var(--danger)', marginTop: 10, fontSize: 14 }}>{error}</p>}
    </div>
  );
}
