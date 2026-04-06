'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUsers } from '@/hooks/use-users';

export default function NewUserPage() {
  const router = useRouter();
  const { createUser } = useUsers();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('customs');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createUser({ email, password, role });
      router.push('/users');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка при создании';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 500 }}>
      <h1>Новый пользователь</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email" style={{ display: 'block', marginBottom: 4 }}>Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: 8, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={{ display: 'block', marginBottom: 4 }}>Пароль</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} style={{ width: '100%', padding: 8, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="role" style={{ display: 'block', marginBottom: 4 }}>Роль</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}>
            <option value="customs">Таможня</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: '10px 24px', cursor: 'pointer', marginRight: 8 }}>
          {loading ? 'Создание...' : 'Создать'}
        </button>
        <button type="button" onClick={() => router.back()} style={{ padding: '10px 24px', cursor: 'pointer' }}>
          Отмена
        </button>
      </form>
    </div>
  );
}
