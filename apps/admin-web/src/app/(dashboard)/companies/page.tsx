'use client';

import { CompanyBotsPanel } from '@/components/company-bots-panel';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useCompanies } from '@/hooks/use-companies';
import { fmtDate } from '@/lib/format';
import { btnLink, primaryLink, td, tdEmpty, th } from '@/lib/table-styles';
import type { CompanyTheme } from '@/lib/types';
import { FormEvent, Fragment, useState } from 'react';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'name', label: 'Название' },
  { field: 'createdAt', label: 'Создана' },
];

const THEME_OPTIONS: { value: CompanyTheme; label: string }[] = [
  { value: 'default', label: 'Базовая' },
  { value: 'sky', label: 'Небо (голубая)' },
];

const TABLE_COLSPAN = 6;

export default function CompaniesPage() {
  const { user } = useAuth();
  const {
    companies,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    setPage,
    toggleSort,
    createCompany,
    updateCompany,
    deleteCompany,
  } = useCompanies();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (user && user.role !== 'super_admin') {
    return <p>Недостаточно прав для просмотра этого раздела.</p>;
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setCreating(true);
    try {
      await createCompany({ name: name.trim(), slug: slug.trim() || undefined });
      setName('');
      setSlug('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка при создании');
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string, currentName: string) {
    const next = prompt('Новое название компании', currentName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    try {
      await updateCompany(id, { name: trimmed });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Ошибка при переименовании');
    }
  }

  async function handleEditSlug(id: string, currentSlug: string | null) {
    // slug кабинета (cabinet/<slug>): lowercase/цифры/дефисы; пустая строка — снять slug.
    const next = prompt('URL-slug кабинета (пусто — снять)', currentSlug ?? '');
    if (next == null) return;
    const trimmed = next.trim();
    if (trimmed === (currentSlug ?? '')) return;
    try {
      await updateCompany(id, { slug: trimmed });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Ошибка при сохранении slug');
    }
  }

  async function handleEditDomains(id: string, current: string[]) {
    // Домены тенанта: по ним админка темизируется и гейтит вход. Через запятую или с новой строки;
    // пусто — снять все домены. Нормализацию/уникальность проверяет бэк.
    const next = prompt(
      'Домены тенанта (через запятую или с новой строки)',
      current.join('\n'),
    );
    if (next == null) return;
    const domains = next
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await updateCompany(id, { domains });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Ошибка при сохранении доменов');
    }
  }

  async function handleChangeTheme(id: string, theme: CompanyTheme) {
    try {
      await updateCompany(id, { theme });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Ошибка при смене темы');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Удалить компанию? Это возможно только если в ней нет пользователей.')) return;
    try {
      await deleteCompany(id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить компанию');
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>Компании</h1>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название новой компании"
          style={{ flex: 1, maxWidth: 360, padding: 8, boxSizing: 'border-box' }}
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug кабинета (опц.)"
          style={{ width: 200, padding: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" disabled={creating || !name.trim()} style={primaryLink}>
          {creating ? 'Создание...' : 'Создать'}
        </button>
      </form>
      {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {sortableColumns.map((col) => (
                  <SortableTh
                    key={col.field}
                    field={col.field}
                    label={col.label}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                  />
                ))}
                <th style={th}>Slug</th>
                <th style={th}>Домены</th>
                <th style={th}>Тема</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td style={td}>{c.name}</td>
                    <td style={td}>{fmtDate(c.createdAt)}</td>
                    <td style={td}>{c.slug ?? '—'}</td>
                    <td style={td}>
                      {c.domains.length > 0 ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {c.domains.join(', ')}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={td}>
                      <select
                        value={c.theme}
                        onChange={(e) => handleChangeTheme(c.id, e.target.value as CompanyTheme)}
                        style={{ padding: '4px 6px', fontSize: 13 }}
                      >
                        {THEME_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        style={{ ...btnLink, color: 'var(--accent)', marginRight: 12 }}
                      >
                        {expandedId === c.id ? 'Скрыть ботов' : 'Боты'}
                      </button>
                      <button
                        onClick={() => handleRename(c.id, c.name)}
                        style={{ ...btnLink, color: 'var(--accent)', marginRight: 12 }}
                      >
                        Переименовать
                      </button>
                      <button
                        onClick={() => handleEditSlug(c.id, c.slug)}
                        style={{ ...btnLink, color: 'var(--accent)', marginRight: 12 }}
                      >
                        Slug
                      </button>
                      <button
                        onClick={() => handleEditDomains(c.id, c.domains)}
                        style={{ ...btnLink, color: 'var(--accent)', marginRight: 12 }}
                      >
                        Домены
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        style={{ ...btnLink, color: 'var(--danger)' }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td style={{ ...td, background: 'var(--bg-subtle)' }} colSpan={TABLE_COLSPAN}>
                        <CompanyBotsPanel companyId={c.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={TABLE_COLSPAN}>
                    Компаний пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pager page={page} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
