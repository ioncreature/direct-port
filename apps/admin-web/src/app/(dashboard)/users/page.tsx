'use client';

import { CompanySelect } from '@/components/company-select';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useUsers } from '@/hooks/use-users';
import { fmtDate } from '@/lib/format';
import { btnLink, filterChip, primaryLink, tdEmpty, td, th } from '@/lib/table-styles';
import type { User } from '@/lib/types';
import Link from 'next/link';

const roles: { value: User['role'] | ''; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'admin', label: 'Администратор' },
  { value: 'customs', label: 'Таможня' },
  { value: 'super_admin', label: 'Глобальный администратор' },
];

const sortableColumns: { field: string; label: string }[] = [
  { field: 'email', label: 'Email' },
  { field: 'role', label: 'Роль' },
  { field: 'createdAt', label: 'Создан' },
];

export default function UsersPage() {
  const { user: actor } = useAuth();
  const isSuperAdmin = actor?.role === 'super_admin';
  const {
    users,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    role,
    companyId,
    setPage,
    toggleSort,
    filterByRole,
    filterByCompany,
    deleteUser,
  } = useUsers();

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
        <h1>Пользователи</h1>
        <Link href="/users/new" style={primaryLink}>
          Создать
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {roles
            .filter((r) => r.value !== 'super_admin' || isSuperAdmin)
            .map((r) => (
              <button
                key={r.value}
                onClick={() => filterByRole(r.value)}
                style={filterChip(role === r.value)}
              >
                {r.label}
              </button>
            ))}
        </div>
        {isSuperAdmin && <CompanySelect value={companyId} onChange={filterByCompany} />}
      </div>

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
                {isSuperAdmin && <th style={th}>Компания</th>}
                <th style={th}>Активен</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={td}>{user.email}</td>
                  <td style={td}>{user.role}</td>
                  <td style={td}>{fmtDate(user.createdAt)}</td>
                  {isSuperAdmin && <td style={td}>{user.companyName ?? '—'}</td>}
                  <td style={td}>{user.isActive ? 'Да' : 'Нет'}</td>
                  <td style={td}>
                    <Link
                      href={`/users/${user.id}/edit`}
                      style={{ color: 'var(--accent)', marginRight: 12, textDecoration: 'none' }}
                    >
                      Изменить
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm('Удалить пользователя?')) deleteUser(user.id);
                      }}
                      style={{ ...btnLink, color: 'var(--danger)' }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={isSuperAdmin ? 6 : 5}>
                    Пользователей не найдено
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
