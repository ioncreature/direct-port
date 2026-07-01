'use client';

import { LoginCard } from '@/components/login-card';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '';

/** Вход по bare-домену → дефолтная компания (виджет дефолтного бота, без slug). */
export default function LoginPage() {
  return <LoginCard botUsername={BOT_USERNAME || null} />;
}
