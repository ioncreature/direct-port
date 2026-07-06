import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { BrandingProvider } from '@/components/branding-provider';
import { resolveBranding, STRICT_UNKNOWN_TENANT } from '@/lib/tenant';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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

export async function generateMetadata(): Promise<Metadata> {
  // Favicon тенанта резолвится по домену запроса: свой favicon есть → отдаём его (<link rel="icon">),
  // иначе дефолтный DirectPort (/icon.svg из public). Иконку задаём ТОЛЬКО через metadata (статический
  // app/icon.svg убран) — file-convention иконки Next перебивают metadata.icons, что сломало бы тенанта.
  // resolveBranding кэширует резолв (60с/домен), поэтому RootLayout ниже не бьёт API повторно.
  const { faviconUrl } = await resolveBranding();
  return {
    title: 'DirectPort',
    description: 'Импорт товаров в Россию',
    icons: { icon: faviconUrl ?? '/icon.svg' },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Брендинг тенанта определяется по домену запроса (серверно): тема вешается на <html data-theme>
  // (её подхватывают CSS-переменные globals.css), логотип прокидывается в клиентские компоненты
  // через BrandingProvider — всё в SSR-разметке, без вспышки нетемизированного контента.
  const { theme, logoUrl, known } = await resolveBranding();
  // Строгий режим (env UNKNOWN_TENANT_BEHAVIOR=404): домен не привязан к компании → 404 на все
  // страницы, а не показ админки от дефолтной компании. k8s-пробы бьют /healthz (вне layout).
  if (STRICT_UNKNOWN_TENANT && !known) notFound();
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
