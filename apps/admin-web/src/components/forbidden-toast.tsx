'use client';

import { API_FORBIDDEN_EVENT } from '@/lib/api';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export function ForbiddenToast() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(API_FORBIDDEN_EVENT, handler);
    return () => window.removeEventListener(API_FORBIDDEN_EVENT, handler);
  }, []);

  useEffect(() => {
    setVisible(false);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        background: '#fee2e2',
        border: '1px solid #fca5a5',
        color: '#991b1b',
        padding: '12px 16px',
        borderRadius: 4,
        fontSize: 14,
        zIndex: 1000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 400,
      }}
    >
      <span>Недостаточно прав для просмотра этого раздела</span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Закрыть"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#991b1b',
          cursor: 'pointer',
          fontSize: 18,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
