import { AuthProvider } from '@/components/auth-provider';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DirectPort',
  description: 'Импорт товаров в Россию',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <style>{`@keyframes dp-pulse { 0%, 100% { transform: scale(1); opacity: 0.4; } 50% { transform: scale(1.25); opacity: 0; } }`}</style>
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
