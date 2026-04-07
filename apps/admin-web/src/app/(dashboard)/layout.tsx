'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import Link from 'next/link';

const navItems = [
  { href: '/', label: 'Дашборд' },
  { href: '/users', label: 'Пользователи' },
  { href: '/telegram-users', label: 'Telegram' },
  { href: '/documents', label: 'Документы' },
  { href: '/tn-ved', label: 'ТН ВЭД' },
  { href: '/settings', label: 'Настройки' },
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
    return <div style={{ padding: 40 }}>Загрузка...</div>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid #ddd', padding: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 24 }}>DirectPort</h2>
        <nav>
          {navItems.map((item) => {
            const active = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '8px 12px',
                  marginBottom: 4,
                  textDecoration: 'none',
                  color: active ? '#000' : '#666',
                  fontWeight: active ? 'bold' : 'normal',
                  backgroundColor: active ? '#f0f0f0' : 'transparent',
                  borderRadius: 4,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid #ddd', position: 'absolute', bottom: 16 }}>
          <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{user.email}</div>
          <button onClick={logout} style={{ cursor: 'pointer', padding: '4px 8px' }}>
            Выйти
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        {children}
      </main>
    </div>
  );
}
