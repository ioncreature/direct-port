'use client';

import { BrandMark, Wordmark } from '@/components/brand';
import { ForbiddenToast } from '@/components/forbidden-toast';
import { useAuth } from '@/hooks/use-auth';
import { ADMIN_ROLES, SUPER_ADMIN_ROLES } from '@/lib/roles';
import { btnOutline } from '@/lib/table-styles';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

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

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Загрузка...</div>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 232,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--sidebar-bg)',
          padding: '20px 14px',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 6px',
            marginBottom: 26,
          }}
        >
          <BrandMark size={30} />
          <Wordmark fontSize={16} />
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
      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px', paddingBottom: 64 }}>
        {/* Ограничение ширины: на ультрашироких мониторах строки таблиц и сетки
            карточек не должны растягиваться на всю ширину экрана. Центрируем
            контейнер авто-маргинами, чтобы контент не прилипал к левому краю. */}
        <div style={{ maxWidth: 1360, marginInline: 'auto' }}>{children}</div>
      </main>
      <ForbiddenToast />
    </div>
  );
}
