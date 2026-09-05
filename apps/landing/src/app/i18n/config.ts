import type { Metadata } from 'next';

export const locales = ['ru', 'en', 'zh'] as const;

export type Locale = (typeof locales)[number];

// Русский живёт на корне (`/`), остальные — с префиксом (`/en`, `/zh`).
export const defaultLocale: Locale = 'ru';

export const localeMeta: Record<
  Locale,
  { short: string; name: string; htmlLang: string; ogLocale: string }
> = {
  ru: { short: 'RU', name: 'Русский', htmlLang: 'ru', ogLocale: 'ru_RU' },
  en: { short: 'EN', name: 'English', htmlLang: 'en', ogLocale: 'en_US' },
  zh: { short: '中文', name: '中文', htmlLang: 'zh-Hans', ogLocale: 'zh_CN' },
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Путь до корня локали: ru → `/`, en → `/en`, zh → `/zh`. */
export function localePath(locale: Locale): string {
  return locale === defaultLocale ? '/' : `/${locale}`;
}

/**
 * Путь до внутренней страницы с учётом локали: ('ru','calculator') → `/calculator`,
 * ('en','calculator') → `/en/calculator`. Без subPath — корень локали.
 */
export function pagePath(locale: Locale, subPath?: string): string {
  if (!subPath) return localePath(locale);
  return locale === defaultLocale ? `/${subPath}` : `/${locale}/${subPath}`;
}

/** hreflang-alternates для metadata.alternates.languages (для страницы subPath, если задан). */
export function hreflangAlternates(subPath?: string): Record<string, string> {
  const languages: Record<string, string> = { 'x-default': pagePath(defaultLocale, subPath) };
  for (const locale of locales) {
    languages[localeMeta[locale].htmlLang] = pagePath(locale, subPath);
  }
  return languages;
}

/**
 * SEO-обвязка внутренней страницы локали: canonical + hreflang + OpenGraph.
 * Одна точка на все страницы — иначе canonical/hreflang легко забыть в копии,
 * и деградирует ровно то, ради чего страница делается.
 */
export function pageMetadata(
  locale: Locale,
  subPath: string,
  page: { metaTitle: string; metaDescription: string },
): Metadata {
  const url = pagePath(locale, subPath);
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: {
      canonical: url,
      languages: hreflangAlternates(subPath),
    },
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      type: 'website',
      url,
      locale: localeMeta[locale].ogLocale,
    },
  };
}
