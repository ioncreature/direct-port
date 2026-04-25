import { I18n, type I18nFlavor } from '@grammyjs/i18n';
import { type Context } from 'grammy';
import * as path from 'path';

export const SUPPORTED_LOCALES = ['ru', 'zh', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Context extended with i18n flavor (ctx.t, ctx.i18n). */
export type BotContext = Context & I18nFlavor;

export const i18n = new I18n<BotContext>({
  defaultLocale: 'en',
  directory: path.join(__dirname, 'locales'),
  useSession: false,
});

/** Map Telegram language_code to one of our supported locales. */
export function mapTelegramLocale(languageCode: string | undefined): SupportedLocale {
  if (!languageCode) return 'en';
  if (languageCode.startsWith('ru')) return 'ru';
  if (languageCode.startsWith('zh')) return 'zh';
  return 'en';
}

/**
 * Render an `error-{code}` Fluent key with safe fallback. If the code is
 * missing or its key is not defined in the locale, returns the fallback key.
 *
 * Fluent returns the literal `{error-FOO}` placeholder for unknown keys,
 * which would leak through to the user — guard against that.
 */
export function tErrorCode(
  language: string | undefined,
  code: string | undefined,
  fallbackKey: string,
): string {
  const lang = mapTelegramLocale(language);
  if (!code) return i18n.t(lang, fallbackKey);
  const value = i18n.t(lang, `error-${code}`);
  if (value.startsWith('{') && value.endsWith('}')) return i18n.t(lang, fallbackKey);
  return value;
}
