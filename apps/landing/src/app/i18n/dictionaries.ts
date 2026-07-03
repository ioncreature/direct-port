import type { Locale } from './config';
import { ru, type Dictionary } from './dictionaries/ru';
import { en } from './dictionaries/en';
import { zh } from './dictionaries/zh';

export type { Dictionary } from './dictionaries/ru';

const dictionaries: Record<Locale, Dictionary> = { ru, en, zh };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
