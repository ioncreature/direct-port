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
