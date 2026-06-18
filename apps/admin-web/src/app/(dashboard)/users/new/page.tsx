'use client';

import { CompanySelect } from '@/components/company-select';
import { useAuth } from '@/hooks/use-auth';
import { useUsers } from '@/hooks/use-users';
import type { User } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function NewUserPage() {
  const router = useRouter();
  const { user: actor } = useAuth();
  const { createUser } = useUsers();
  const isSuperAdmin = actor?.role === 'super_admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('customs');
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // super_admin создаёт пользователей в любой компании (для admin/customs нужно выбрать
  // компанию). admin компании создаёт только в своей — поле компании скрыто, наследуется.
  const needsCompany = isSuperAdmin && role !== 'super_admin';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (needsCompany && !companyId) {
      setError('Выберите компанию');
      return;
    }
    setLoading(true);
    try {
      await createUser({ email, password, role, ...(needsCompany ? { companyId } : {}) });
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
          <label htmlFor="email" style={{ display: 'block', marginBottom: 4 }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={{ display: 'block', marginBottom: 4 }}>
            Пароль
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="role" style={{ display: 'block', marginBottom: 4 }}>
            Роль
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as User['role'])}
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          >
            <option value="customs">Таможня</option>
            <option value="admin">Администратор</option>
            {isSuperAdmin && <option value="super_admin">Глобальный администратор</option>}
          </select>
        </div>
        {needsCompany && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="company" style={{ display: 'block', marginBottom: 4 }}>
              Компания
            </label>
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              allLabel="— выберите компанию —"
              style={{ width: '100%' }}
            />
          </div>
        )}
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '10px 24px', cursor: 'pointer', marginRight: 8 }}
        >
          {loading ? 'Создание...' : 'Создать'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{ padding: '10px 24px', cursor: 'pointer' }}
        >
          Отмена
        </button>
      </form>
    </div>
  );
}
