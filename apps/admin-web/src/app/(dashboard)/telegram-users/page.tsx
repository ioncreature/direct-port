'use client';

import { useTelegramUsers } from '@/hooks/use-telegram-users';

export default function TelegramUsersPage() {
  const { telegramUsers, loading, refetch } = useTelegramUsers();

  if (loading) return <p>Загрузка...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Telegram-пользователи</h1>
        <button
          onClick={refetch}
          style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: 4, border: '1px solid #ddd' }}
        >
          Обновить
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Telegram ID</th>
            <th style={th}>Username</th>
            <th style={th}>Имя</th>
            <th style={th}>Документов</th>
            <th style={th}>Дата регистрации</th>
          </tr>
        </thead>
        <tbody>
          {telegramUsers.map((u) => (
            <tr key={u.id}>
              <td style={td}>{u.telegramId}</td>
              <td style={td}>{u.username ? `@${u.username}` : '—'}</td>
              <td style={td}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
              <td style={td}>{u.documentCount ?? 0}</td>
              <td style={td}>{new Date(u.createdAt).toLocaleDateString('ru')}</td>
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
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #ddd' };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #eee' };
