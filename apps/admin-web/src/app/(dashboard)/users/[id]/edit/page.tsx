'use client';

import { CompanySelect } from '@/components/company-select';
import { useAuth } from '@/hooks/use-auth';
import { useUsers } from '@/hooks/use-users';
import type { User } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { TelegramLinkSection } from './telegram-link-section';

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: actor } = useAuth();
  const { users, loading: usersLoading, updateUser } = useUsers();
  const isSuperAdmin = actor?.role === 'super_admin';

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<User['role']>('customs');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const user = users.find((u) => u.id === id);

  // super_admin может перенести admin/customs в другую компанию. Для super_admin-пользователя
  // компании нет — поле скрыто. admin компании поле не видит (наследует свою).
  const needsCompany = isSuperAdmin && role !== 'super_admin';

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setRole(user.role);
      setIsActive(user.isActive);
      setCompanyId(user.companyId ?? '');
    }
  }, [user]);

  if (usersLoading) return <p>Загрузка...</p>;
  if (!user) return <p>Пользователь не найден</p>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (needsCompany && !companyId) {
      setError('Выберите компанию');
      return;
    }
    setSaving(true);
    try {
      await updateUser(id, {
        email,
        role,
        isActive,
        ...(password ? { password } : {}),
        ...(needsCompany ? { companyId } : {}),
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
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={labelStyle}>
            Новый пароль (оставьте пустым, чтобы не менять)
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="role" style={labelStyle}>
            Роль
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as User['role'])}
            style={inputStyle}
          >
            <option value="customs">Таможня</option>
            <option value="admin">Администратор</option>
            {(isSuperAdmin || role === 'super_admin') && (
              <option value="super_admin">Глобальный администратор</option>
            )}
          </select>
        </div>
        {needsCompany && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="company" style={labelStyle}>
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
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Активен
          </label>
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button
          type="submit"
          disabled={saving}
          style={{ padding: '10px 24px', cursor: 'pointer', marginRight: 8 }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{ padding: '10px 24px', cursor: 'pointer' }}
        >
          Отмена
        </button>
      </form>

      <TelegramLinkSection user={user} />
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 8, boxSizing: 'border-box' };
