'use client';

import { TenantBrand } from '@/components/brand';
import { ForbiddenToast } from '@/components/forbidden-toast';
import { useAuth } from '@/hooks/use-auth';
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from '@/lib/roles';
import { btnOutline } from '@/lib/table-styles';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// roles не задан → пункт виден всем ролям. super_admin проходит везде через bypass на бэке,
// поэтому добавляем его в каждый ограниченный список явно.
const navItems: { href: string; label: string; roles?: readonly string[] }[] = [
  { href: '/', label: 'Дашборд' },
  { href: '/users', label: 'Пользователи', roles: ADMIN_ROLES },
  { href: '/telegram-users', label: 'Telegram' },
  { href: '/documents', label: 'Документы' },
  { href: '/tn-ved', label: 'ТН ВЭД' },
  { href: '/leads', label: 'Лиды', roles: SUPER_ADMIN_ROLES },
  { href: '/ai-costs', label: 'AI-расходы', roles: ADMIN_ROLES },
  { href: '/companies', label: 'Компании', roles: SUPER_ADMIN_ROLES },
  { href: '/settings', label: 'Настройки', roles: SUPER_ADMIN_ROLES },
  { href: '/reference', label: 'Справочник' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Открытие мобильного drawer'а. На десктопе сайдбар всегда виден (CSS),
  // этот стейт влияет только на узкие экраны.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  // Закрываем drawer при переходе на другую страницу.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Пока drawer открыт — блокируем скролл фона и закрываем по Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (loading || !user) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Загрузка...</div>;
  }

  return (
    <div className="dp-shell">
      {/* Мобильная шапка: видна только на узких экранах (CSS) */}
      <header className="dp-topbar">
        <button
          className="dp-burger"
          onClick={() => setMenuOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={menuOpen}
        >
          <MenuIcon />
        </button>
        <TenantBrand markSize={26} wordSize={15} logoHeight={28} />
      </header>

      {/* Затемнение под открытым drawer'ом (только мобильные) */}
      <div
        className={`dp-scrim${menuOpen ? ' is-open' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />

      <aside className={`dp-sidebar${menuOpen ? ' is-open' : ''}`}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 6px',
            marginBottom: 26,
          }}
        >
          <TenantBrand markSize={30} wordSize={16} logoHeight={32} />
          <button
            className="dp-sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть меню"
            style={{ marginLeft: 'auto' }}
          >
            <CloseIcon />
          </button>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {navItems
            .filter((item) => !item.roles || item.roles.includes(user.role))
            .map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className="dp-nav-link"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--accent-soft-text)' : 'var(--text-muted)',
                  background: active ? 'var(--accent-soft)' : undefined,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: active ? 'var(--accent)' : 'var(--text-subtle)',
                    opacity: active ? 1 : 0.4,
                  }}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginBottom: 10,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={user.email}
          >
            {user.email}
          </div>
          <button onClick={logout} style={{ ...btnOutline, width: '100%' }}>
            Выйти
          </button>
        </div>
      </aside>

      <main className="dp-main">
        {/* Ограничение ширины: на ультрашироких мониторах строки таблиц и сетки
            карточек не должны растягиваться на всю ширину экрана. Сам shell
            (меню + контент) центрируется на корневом контейнере выше. */}
        <div className="dp-content">{children}</div>
      </main>
      <ForbiddenToast />
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 5.5h14M3 10h14M3 14.5h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
