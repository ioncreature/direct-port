'use client';

import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useCompanies } from '@/hooks/use-companies';
import { themeLabel } from '@/lib/companies';
import { fmtDate } from '@/lib/format';
import { primaryLink, td, tdEmpty, th } from '@/lib/table-styles';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'name', label: 'Название' },
  { field: 'createdAt', label: 'Создана' },
];

const TABLE_COLSPAN = 5;

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
  } = useCompanies();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

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
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td style={td}>
                    <Link
                      href={`/companies/${c.id}`}
                      style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {c.name}
                    </Link>
                  </td>
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
                  <td style={td}>{themeLabel(c.theme)}</td>
                </tr>
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
