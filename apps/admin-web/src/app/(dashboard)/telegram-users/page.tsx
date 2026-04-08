'use client';

import Link from 'next/link';
import { useTelegramUsers } from '@/hooks/use-telegram-users';
import { th, td, btnOutline } from '@/lib/table-styles';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'username', label: 'Username' },
  { field: 'createdAt', label: 'Дата регистрации' },
];

export default function TelegramUsersPage() {
  const {
    telegramUsers, total, loading, page, limit, sortBy, sortOrder,
    setPage, toggleSort, refetch,
  } = useTelegramUsers();

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function sortIndicator(field: string) {
    if (sortBy !== field) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Telegram-пользователи</h1>
        <button onClick={refetch} style={btnOutline}>Обновить</button>
      </div>

      {loading ? <p>Загрузка...</p> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Telegram ID</th>
                {sortableColumns.map((col) => (
                  <th key={col.field} style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col.field)}>
                    {col.label}{sortIndicator(col.field)}
                  </th>
                ))}
                <th style={th}>Имя</th>
                <th style={th}>Документов</th>
              </tr>
            </thead>
            <tbody>
              {telegramUsers.map((u) => (
                <tr key={u.id}>
                  <td style={td}>
                    <Link href={`/telegram-users/${u.id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                      {u.telegramId}
                    </Link>
                  </td>
                  <td style={td}>{u.username ? `@${u.username}` : '—'}</td>
                  <td style={td}>{new Date(u.createdAt).toLocaleDateString('ru')}</td>
                  <td style={td}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td style={td}>{u.documentCount ?? 0}</td>
                </tr>
              ))}
              {telegramUsers.length === 0 && (
                <tr>
                  <td style={{ ...td, textAlign: 'center', color: '#888' }} colSpan={5}>
                    Telegram-пользователей пока нет
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
