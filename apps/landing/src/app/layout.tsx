import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DirectPort — Импорт товаров в Россию',
  description: 'Оформление деклараций, расчёт таможенных пошлин и налогов. Быстро и прозрачно.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
