import { AuthProvider } from '@/components/auth-provider';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DirectPort',
  description: 'Импорт товаров в Россию',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
