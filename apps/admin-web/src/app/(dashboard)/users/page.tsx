'use client';

import Link from 'next/link';
import { useUsers } from '@/hooks/use-users';

export default function UsersPage() {
  const { users, loading, deleteUser } = useUsers();

  if (loading) return <p>Загрузка...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Пользователи</h1>
        <Link href="/users/new" style={{ padding: '8px 16px', backgroundColor: '#000', color: '#fff', textDecoration: 'none', borderRadius: 4 }}>
          Создать
        </Link>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Email</th>
            <th style={th}>Роль</th>
            <th style={th}>Активен</th>
            <th style={th}>Создан</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td style={td}>{user.email}</td>
              <td style={td}>{user.role}</td>
              <td style={td}>{user.isActive ? 'Да' : 'Нет'}</td>
              <td style={td}>{new Date(user.createdAt).toLocaleDateString('ru')}</td>
              <td style={td}>
                <button
                  onClick={() => { if (confirm('Удалить пользователя?')) deleteUser(user.id); }}
                  style={{ color: 'red', cursor: 'pointer', border: 'none', background: 'none' }}
                >
                  Удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #ddd' };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #eee' };
