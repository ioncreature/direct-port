/**
 * Темы оформления админки под тенанта. Тема выбирается на компанию и применяется в admin-web
 * по домену запроса (см. apps/admin-web корневой layout + globals.css). Список — единый источник
 * истины для валидации DTO и типов; каждая тема должна иметь соответствующий блок CSS-переменных
 * `:root[data-theme="<theme>"]` в apps/admin-web/src/app/globals.css.
 */
export const COMPANY_THEMES = ['default', 'sky', 'orbit'] as const;

export type CompanyTheme = (typeof COMPANY_THEMES)[number];

/** Тема по умолчанию — базовая палитра «Глубокая вода» (совпадает с :root без data-theme). */
export const DEFAULT_COMPANY_THEME: CompanyTheme = 'default';

export function isCompanyTheme(value: unknown): value is CompanyTheme {
  return typeof value === 'string' && (COMPANY_THEMES as readonly string[]).includes(value);
}

/** Нормализует произвольное значение темы к валидному (неизвестное → дефолт). */
export function normalizeCompanyTheme(value: unknown): CompanyTheme {
  return isCompanyTheme(value) ? value : DEFAULT_COMPANY_THEME;
}
