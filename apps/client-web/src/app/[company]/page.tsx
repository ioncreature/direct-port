'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoginCard } from '@/components/login-card';
import type { CompanyPublicInfo } from '@/lib/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; info: CompanyPublicInfo }
  | { status: 'notfound' };

/**
 * Вход per-company по URL-slug (`cabinet/<slug>`): резолвим компанию через публичный BFF-эндпоинт
 * (без auth), рендерим виджет ИМЕННО её client-бота. Неизвестный slug → «компания не найдена»;
 * компания без своего бота → понятный текст вместо виджета. См. docs/COMPANY_BOTS.md (Фаза 4).
 */
export default function CompanyLoginPage() {
  const slug = useParams<{ company: string }>().company;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    fetch(`/api/client/company?slug=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? (res.json() as Promise<CompanyPublicInfo>) : Promise.reject(res)))
      .then((info) => active && setState({ status: 'ready', info }))
      .catch(() => active && setState({ status: 'notfound' }));
    return () => {
      active = false;
    };
  }, [slug]);

  if (state.status === 'loading') return <Shell>Загрузка…</Shell>;
  if (state.status === 'notfound')
    return <Shell error>Компания не найдена. Проверьте ссылку.</Shell>;

  return (
    <LoginCard
      botUsername={state.info.clientBotUsername}
      slug={slug}
      companyName={state.info.name}
      notConfiguredText="Вход для этой компании ещё не настроен. Обратитесь к вашему менеджеру."
    />
  );
}

/** Минимальная карточка для промежуточных состояний (загрузка / не найдено). */
function Shell({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo" style={{ justifyContent: 'center' }}>
          <span className="logo-mark">DP</span>
          <span>DirectPort</span>
        </div>
        <p className={error ? 'error-text' : undefined} style={{ marginTop: 16 }}>
          {children}
        </p>
      </div>
    </div>
  );
}
