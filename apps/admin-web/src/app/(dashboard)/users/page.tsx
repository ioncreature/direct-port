'use client';

import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useUsers } from '@/hooks/use-users';
import { fmtDate } from '@/lib/format';
import { tdEmpty, td, th } from '@/lib/table-styles';
import type { User } from '@/lib/types';
import Link from 'next/link';

const roles: { value: User['role'] | ''; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'admin', label: 'Администратор' },
  { value: 'customs', label: 'Таможня' },
];

const sortableColumns: { field: string; label: string }[] = [
  { field: 'email', label: 'Email' },
  { field: 'role', label: 'Роль' },
  { field: 'createdAt', label: 'Создан' },
];

export default function UsersPage() {
  const {
    users,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    role,
    setPage,
    toggleSort,
    filterByRole,
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
        <Link
          href="/users/new"
          style={{
            padding: '8px 16px',
            backgroundColor: '#000',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: 4,
          }}
        >
          Создать
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {roles.map((r) => (
          <button
            key={r.value}
            onClick={() => filterByRole(r.value)}
            style={{
              padding: '4px 12px',
              borderRadius: 16,
              cursor: 'pointer',
              fontSize: 13,
              border: '1px solid #ddd',
              background: role === r.value ? '#2563eb' : '#fff',
              color: role === r.value ? '#fff' : '#333',
            }}
          >
            {r.label}
          </button>
        ))}
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
                  <td style={td}>{user.isActive ? 'Да' : 'Нет'}</td>
                  <td style={td}>
                    <Link
                      href={`/users/${user.id}/edit`}
                      style={{ color: '#2563eb', marginRight: 12, textDecoration: 'none' }}
                    >
                      Изменить
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm('Удалить пользователя?')) deleteUser(user.id);
                      }}
                      style={{
                        color: 'red',
                        cursor: 'pointer',
                        border: 'none',
                        background: 'none',
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={5}>
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
