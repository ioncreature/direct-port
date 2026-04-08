'use client';

import Link from 'next/link';
import { useUsers } from '@/hooks/use-users';
import { th, td, btnOutline } from '@/lib/table-styles';

const roles: { value: 'admin' | 'customs' | ''; label: string }[] = [
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
    users, total, loading, page, limit, sortBy, sortOrder, role,
    setPage, toggleSort, filterByRole, deleteUser,
  } = useUsers();

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function sortIndicator(field: string) {
    if (sortBy !== field) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Пользователи</h1>
        <Link href="/users/new" style={{ padding: '8px 16px', backgroundColor: '#000', color: '#fff', textDecoration: 'none', borderRadius: 4 }}>
          Создать
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {roles.map((r) => (
          <button
            key={r.value}
            onClick={() => filterByRole(r.value)}
            style={{
              padding: '4px 12px', borderRadius: 16, cursor: 'pointer', fontSize: 13,
              border: '1px solid #ddd',
              background: role === r.value ? '#2563eb' : '#fff',
              color: role === r.value ? '#fff' : '#333',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? <p>Загрузка...</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {sortableColumns.map((col) => (
                  <th key={col.field} style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col.field)}>
                    {col.label}{sortIndicator(col.field)}
                  </th>
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
                  <td style={td}>{new Date(user.createdAt).toLocaleDateString('ru')}</td>
                  <td style={td}>{user.isActive ? 'Да' : 'Нет'}</td>
                  <td style={td}>
                    <Link href={`/users/${user.id}/edit`} style={{ color: '#2563eb', marginRight: 12, textDecoration: 'none' }}>
                      Изменить
                    </Link>
                    <button
                      onClick={() => { if (confirm('Удалить пользователя?')) deleteUser(user.id); }}
                      style={{ color: 'red', cursor: 'pointer', border: 'none', background: 'none' }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td style={{ ...td, textAlign: 'center', color: '#888' }} colSpan={5}>
                    Пользователей не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 14 }}>
            <span style={{ color: '#666' }}>Всего: {total}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} style={btnOutline}>← Пред</button>
              <span>{page} из {totalPages}</span>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages} style={btnOutline}>След →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
