'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUsers } from '@/hooks/use-users';

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { users, loading: usersLoading, updateUser } = useUsers();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('customs');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const user = users.find((u) => u.id === id);

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setRole(user.role);
      setIsActive(user.isActive);
    }
  }, [user]);

  if (usersLoading) return <p>Загрузка...</p>;
  if (!user) return <p>Пользователь не найден</p>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateUser(id, {
        email,
        role,
        isActive,
        ...(password ? { password } : {}),
      });
      router.push('/users');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка при сохранении';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 500 }}>
      <h1>Редактирование пользователя</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email" style={labelStyle}>Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={labelStyle}>Новый пароль (оставьте пустым, чтобы не менять)</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="role" style={labelStyle}>Роль</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
            <option value="customs">Таможня</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Активен
          </label>
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={saving} style={{ padding: '10px 24px', cursor: 'pointer', marginRight: 8 }}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button type="button" onClick={() => router.back()} style={{ padding: '10px 24px', cursor: 'pointer' }}>
          Отмена
        </button>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 8, boxSizing: 'border-box' };
