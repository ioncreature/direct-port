'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { TelegramLogin } from '@/components/telegram-login';
import { isAuthenticated, loginWithTelegram, type TelegramAuthData } from '@/lib/auth';

/**
 * Карточка входа в кабинет. Переиспользуется bare-доменом (дефолтная компания, `app/page.tsx`)
 * и per-company slug-роутом (`app/[company]/page.tsx`): отличаются только username бота, slug
 * и брендингом. После успешного входа уходим на дашборд (он скоупится client-JWT, slug не нужен).
 */
export function LoginCard({
  botUsername,
  slug,
  companyName,
  notConfiguredText,
}: {
  botUsername: string | null;
  slug?: string;
  companyName?: string;
  notConfiguredText?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) router.replace('/dashboard');
  }, [router]);

  const handleAuth = useCallback(
    async (data: TelegramAuthData) => {
      setError(null);
      try {
        await loginWithTelegram(data, slug);
        router.replace('/dashboard');
      } catch {
        setError('Не удалось войти. Попробуйте ещё раз.');
      }
    },
    [router, slug],
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo" style={{ justifyContent: 'center' }}>
          <span className="logo-mark">DP</span>
          <span>{companyName || 'DirectPort'}</span>
        </div>
        <h1>Личный кабинет</h1>
        <p>
          Войдите через Telegram, чтобы видеть баланс, историю операций и результаты расчётов
          пошлин.
        </p>
        {botUsername ? (
          <TelegramLogin botUsername={botUsername} onAuth={handleAuth} />
        ) : (
          <p className="error-text">
            {notConfiguredText ??
              'Виджет входа не настроен: задайте NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.'}
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
