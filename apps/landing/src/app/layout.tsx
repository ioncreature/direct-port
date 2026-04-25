import type { Metadata } from 'next';
import './globals.css';
import { SITE_DESCRIPTION, SITE_DESCRIPTION_OG, SITE_TITLE } from './_brand';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directport.ru';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION_OG,
    type: 'website',
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION_OG,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
