import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Личный кабинет — DirectPort',
  description: 'Баланс, история операций и расчёты пошлин DirectPort',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
