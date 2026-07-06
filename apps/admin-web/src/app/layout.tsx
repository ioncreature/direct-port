import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { BrandingProvider } from '@/components/branding-provider';
import { resolveBranding } from '@/lib/tenant';
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
  // Брендинг тенанта определяется по домену запроса (серверно): тема вешается на <html data-theme>
  // (её подхватывают CSS-переменные globals.css), логотип прокидывается в клиентские компоненты
  // через BrandingProvider — всё в SSR-разметке, без вспышки нетемизированного контента.
  const { theme, logoUrl } = await resolveBranding();
  return (
    <html
      lang="ru"
      data-theme={theme}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <BrandingProvider value={{ logoUrl }}>
          <AuthProvider>{children}</AuthProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
