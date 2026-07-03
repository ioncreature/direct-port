// Языконезависимые константы бренда. Весь копирайтинг (заголовки, описания,
// секции, FAQ, SEO-тексты) вынесен в i18n/dictionaries/*.ts — здесь остаётся
// только то, что одинаково на всех языках: имя бренда, вордмарк, палитра,
// контакты и ссылки.

export const BRAND_NAME = 'DirectPort';

// Визуальный вордмарк — моноширинный direct_port. BRAND_NAME остаётся для
// schema.org / юридического имени, WORDMARK — для отрисовки в шапке/футере.
export const WORDMARK_PREFIX = 'direct';
export const WORDMARK_SEP = '_';
export const WORDMARK_SUFFIX = 'port';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directport.ru';

// Контакты (одни и те же на всех языках)
export const TELEGRAM_BOT_URL =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || 'https://t.me/direct_port_bot';
export const CONTACT_EMAIL = 'hello@directport.ru';
export const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;
export const CONTACT_PHONE = '+7 909 760 7380';
export const CONTACT_PHONE_HREF = `tel:${CONTACT_PHONE.replace(/[^+\d]/g, '')}`;

// Палитра «Глубокая вода»
export const BRAND_INK = '#0B2536';
export const BRAND_PETROL = '#0F6E7C';
export const BRAND_ORANGE = '#E8622A';
export const BRAND_PAPER = '#F6F4EF';
