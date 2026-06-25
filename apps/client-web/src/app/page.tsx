'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { TelegramLogin } from '@/components/telegram-login';
import { isAuthenticated, loginWithTelegram, type TelegramAuthData } from '@/lib/auth';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) router.replace('/dashboard');
  }, [router]);

  const handleAuth = useCallback(
    async (data: TelegramAuthData) => {
      setError(null);
      try {
        await loginWithTelegram(data);
        router.replace('/dashboard');
      } catch {
        setError('Не удалось войти. Попробуйте ещё раз.');
      }
    },
    [router],
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo" style={{ justifyContent: 'center' }}>
          <span className="logo-mark">DP</span>
          <span>DirectPort</span>
        </div>
        <h1>Личный кабинет</h1>
        <p>
          Войдите через Telegram, чтобы видеть баланс, историю операций и результаты расчётов
          пошлин.
        </p>
        {BOT_USERNAME ? (
          <TelegramLogin botUsername={BOT_USERNAME} onAuth={handleAuth} />
        ) : (
          <p className="error-text">
            Виджет входа не настроен: задайте NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.
          </p>
        )}
        {error && (
          <p className="error-text" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
