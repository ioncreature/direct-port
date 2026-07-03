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

/** hreflang-alternates для metadata.alternates.languages. */
export function hreflangAlternates(): Record<string, string> {
  const languages: Record<string, string> = { 'x-default': localePath(defaultLocale) };
  for (const locale of locales) {
    languages[localeMeta[locale].htmlLang] = localePath(locale);
  }
  return languages;
}
