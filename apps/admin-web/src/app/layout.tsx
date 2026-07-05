import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { resolveTheme } from '@/lib/tenant';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jbmono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DirectPort',
  description: 'Импорт товаров в Россию',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Тема тенанта определяется по домену запроса (серверно) и вешается на <html data-theme>,
  // откуда её подхватывают CSS-переменные globals.css — без вспышки нетемизированного контента.
  const theme = await resolveTheme();
  return (
    <html
      lang="ru"
      data-theme={theme}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
