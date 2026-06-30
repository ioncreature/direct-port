'use client';

import { CompanyBotsPanel } from '@/components/company-bots-panel';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useCompanies } from '@/hooks/use-companies';
import { fmtDate } from '@/lib/format';
import { btnLink, primaryLink, td, tdEmpty, th } from '@/lib/table-styles';
import { FormEvent, Fragment, useState } from 'react';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'name', label: 'Название' },
  { field: 'createdAt', label: 'Создана' },
];

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
      await createCompany({ name: name.trim() });
      setName('');
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
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td style={td}>{c.name}</td>
                    <td style={td}>{fmtDate(c.createdAt)}</td>
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
                        onClick={() => handleDelete(c.id)}
                        style={{ ...btnLink, color: 'var(--danger)' }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td style={{ ...td, background: 'var(--bg-muted, #f7f7f7)' }} colSpan={3}>
                        <CompanyBotsPanel companyId={c.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={3}>
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
