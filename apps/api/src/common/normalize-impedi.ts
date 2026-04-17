// Маппинг кодов ОКЕИ (tnvlook.json, tkssoft/api.tks.ru-docs) для полей IMPEDI/IMPEDI2/AKCEDI.
// Базовый код без суффикса — ставка в евро (например, 166 → EUR/кг).
// Суффиксы: D=USD, Р=RUB, A=AMD, B=BYR, C=KGS, K=KZT, E=EUR (спец. вариант).
//
// Код '1' (и алиас '%') означает процентную (адвалорную) ставку — не специфическую.

interface ParsedCode {
  currency: string;
  unit: string;
}

const CURRENCY_BY_SUFFIX: Record<string, string> = {
  D: 'USD',
  Р: 'RUB',
  A: 'AMD',
  B: 'BYR',
  C: 'KGS',
  K: 'KZT',
  E: 'EUR',
};

const OKEI_BASE_TO_UNIT: Record<string, string> = {
  '055': 'м²',
  '111': 'см³',
  '112': 'л',
  '113': 'м³',
  '117': 'т п массы',
  '118': 'м³ВОК',
  '133': 'кг',
  '162': 'кар',
  '163': 'г',
  '166': 'кг',
  '168': 'т',
  '185': 'т грп',
  '214': 'КВТ',
  '251': 'Л.С.',
  '500': '', // 500 = просто Евро (без единицы) — деньгоспецифичный акциз без знаменателя
  '715': 'пар',
  '796': 'шт',
  '798': '1000шт',
  '831': 'л 100% спирта',
  '006': 'м',
};

function parseCode(raw: string): ParsedCode | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Прямое совпадение с базой (без суффикса) → EUR/<unit>
  const directUnit = OKEI_BASE_TO_UNIT[trimmed];
  if (directUnit !== undefined) {
    return { currency: 'EUR', unit: directUnit };
  }

  // Последний символ — валютный суффикс, перед ним базовый код
  const last = trimmed.slice(-1);
  const currency = CURRENCY_BY_SUFFIX[last];
  if (currency) {
    const base = trimmed.slice(0, -1);
    const unit = OKEI_BASE_TO_UNIT[base];
    if (unit !== undefined) return { currency, unit };
  }

  return null;
}

/**
 * Канонизирует IMPEDI/IMPEDI2/AKCEDI в строку вида "EUR/кг", "USD/т", "%".
 * Возвращает:
 *   - null — если поле пустое;
 *   - "%" — если ставка адвалорная (код '1' или явный '%');
 *   - исходное "CURRENCY/UNIT" — если уже в таком виде (содержит '/');
 *   - "EUR/кг" / "USD/т" и т.п. — из ОКЕИ-кода;
 *   - raw как есть — если код неизвестен.
 */
export function normalizeImpediUnit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Уже в формате валюта/единица (например, "EUR/кг", "ДолларСША/т")
  if (trimmed.includes('/')) return trimmed;

  // Адвалорная ставка
  if (trimmed === '1' || trimmed === '%') return '%';

  const parsed = parseCode(trimmed);
  if (parsed) {
    return parsed.unit ? `${parsed.currency}/${parsed.unit}` : parsed.currency;
  }

  return trimmed;
}

/**
 * Специфическая (не адвалорная) ставка — имеет единицу за которой можно
 * взвешивать (кг, пар, м², л, шт и т.п.).
 */
export function isSpecificDutyUnit(normalized: string | null | undefined): boolean {
  if (!normalized) return false;
  if (normalized === '%') return false;
  return normalized.includes('/');
}
