import type { CompanyTheme } from './types';

/** Темы оформления админки под тенанта — единый источник подписей для списка и страницы компании. */
export const THEME_OPTIONS: { value: CompanyTheme; label: string }[] = [
  { value: 'default', label: 'Базовая' },
  { value: 'sky', label: 'Небо (голубая)' },
];

export function themeLabel(theme: string): string {
  return THEME_OPTIONS.find((o) => o.value === theme)?.label ?? theme;
}
