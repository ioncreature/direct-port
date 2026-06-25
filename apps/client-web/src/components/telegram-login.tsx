'use client';

import { useEffect, useRef } from 'react';
import type { TelegramAuthData } from '@/lib/auth';

/**
 * Telegram Login Widget. Скрипт виджета рендерит iframe-кнопку и вызывает глобальный
 * колбэк onTelegramAuth(user) с подписанными данными. Виджет привязан к боту по username;
 * домен кабинета должен быть прописан боту через @BotFather → /setdomain.
 */
export function TelegramLogin({
  botUsername,
  onAuth,
}: {
  botUsername: string;
  onAuth: (data: TelegramAuthData) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    (window as unknown as { onTelegramAuth?: (u: TelegramAuthData) => void }).onTelegramAuth = (
      user,
    ) => onAuthRef.current(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'true');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');

    const container = ref.current;
    container?.appendChild(script);
    return () => {
      if (container) container.innerHTML = '';
    };
  }, [botUsername]);

  return <div className="login-widget" ref={ref} />;
}
