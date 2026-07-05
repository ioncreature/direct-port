'use client';

import { BrandMark, Wordmark } from '@/components/brand';
import { useAuth } from '@/hooks/use-auth';
import { btnPrimary } from '@/lib/table-styles';
import { isAxiosError } from 'axios';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      // Заблокированному аккаунту бэк отдаёт 403 с понятным сообщением — показываем его как есть;
      // всё остальное (неверный логин/пароль, недоступность) сводим к общей формулировке.
      if (isAxiosError(err) && err.response?.status === 403) {
        const msg = (err.response.data as { message?: string } | undefined)?.message;
        setError(msg || 'Ваш аккаунт отключён. Обратитесь к администратору.');
      } else {
        setError('Неверный email или пароль');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 384,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 20 }}>
          <BrandMark size={36} />
          <div>
            <Wordmark fontSize={18} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Вход в систему</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="email" style={labelStyle}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="password" style={labelStyle}>
              Пароль
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          {error && (
            <p
              style={{
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger-soft-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 11px',
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} style={{ ...btnPrimary, width: '100%', padding: 10 }}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-muted)',
};
