// Маппинг IMPEDI/IMPEDI2/AKCEDI → "EUR/кг", "USD/т", "%" по справочнику tnvlook.json
// (tkssoft/api.tks.ru-docs). Базовый ОКЕИ-код без суффикса — ставка в евро;
// последний символ может быть валютным суффиксом (D=USD, Р=RUB и т. д.).

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
  '114': '1000м³',
  '117': 'т п массы',
  '118': 'м³ВОК',
  '130': '1000л',
  '133': 'кг',
  '162': 'кар',
  '163': 'г',
  '166': 'кг',
  '168': 'т',
  '185': 'т грп',
  '214': 'КВТ',
  '251': 'Л.С.',
  '500': '', // просто валюта без знаменателя (редкий акциз с абсолютной суммой)
  '715': 'пар',
  '796': 'шт',
  '798': '1000шт',
  '831': 'л 100% спирта',
  '006': 'м',
};

function parseCode(trimmed: string): { currency: string; unit: string } | null {
  const directUnit = OKEI_BASE_TO_UNIT[trimmed];
  if (directUnit !== undefined) return { currency: 'EUR', unit: directUnit };

  const currency = CURRENCY_BY_SUFFIX[trimmed.slice(-1)];
  if (!currency) return null;
  const unit = OKEI_BASE_TO_UNIT[trimmed.slice(0, -1)];
  return unit !== undefined ? { currency, unit } : null;
}

export function normalizeImpediUnit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/')) return trimmed;

  // '1' — адвалорная для большинства PRIZNAK, '2' — "% (акц)" в акцизном контексте
  if (trimmed === '1' || trimmed === '2' || trimmed === '%') return '%';

  const parsed = parseCode(trimmed);
  if (parsed) return parsed.unit ? `${parsed.currency}/${parsed.unit}` : parsed.currency;

  return trimmed;
}

export function isSpecificDutyUnit(normalized: string | null | undefined): boolean {
  return !!normalized && normalized !== '%' && normalized.includes('/');
}
