// Маппинг IMPEDI/IMPEDI2/AKCEDI → "EUR/кг", "USD/т", "%" по справочнику tnvlook.json
// (tkssoft/api.tks.ru-docs). Базовый ОКЕИ-код без суффикса — ставка в евро;
// последний символ может быть валютным суффиксом (D=USD, Р=RUB и т. д.).

// BYR — legacy-обозначение белорусского рубля (до деноминации 2016), TKS всё ещё
// использует этот суффикс. В современных курсах ЦБ РФ это BYN.
const SUFFIX_TO_CURRENCY: Record<string, string> = {
  D: 'USD',
  Р: 'RUB',
  A: 'AMD',
  B: 'BYN',
  C: 'KGS',
  K: 'KZT',
  E: 'EUR',
};

export const KNOWN_CURRENCIES: readonly string[] = [
  'EUR',
  'USD',
  'RUB',
  'BYN',
  'AMD',
  'KGS',
  'KZT',
  'CNY',
];

const KNOWN_CURRENCIES_SET = new Set(KNOWN_CURRENCIES);

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

// Коды чистой валюты без единицы измерения (ОКВ). У TKS встречаются в IMPEDI для
// фиксированных абсолютных ставок, например 643 = RUB.
const OKEI_CURRENCY_ONLY: Record<string, string> = {
  '643': 'RUB',
};

// Некоторые источники возвращают код без ведущих нулей ("55" вместо "055").
// Нормализуем до 3-значного представления, если такой известен.
function padToKnown(code: string): string {
  if (code.length >= 3) return code;
  for (let n = 3 - code.length; n > 0; n--) {
    const padded = '0'.repeat(n) + code;
    if (OKEI_BASE_TO_UNIT[padded] !== undefined || OKEI_CURRENCY_ONLY[padded] !== undefined) {
      return padded;
    }
  }
  return code;
}

function parseCode(trimmed: string): { currency: string; unit: string } | null {
  const padded = padToKnown(trimmed);

  if (OKEI_CURRENCY_ONLY[padded] !== undefined) {
    return { currency: OKEI_CURRENCY_ONLY[padded], unit: '' };
  }

  const directUnit = OKEI_BASE_TO_UNIT[padded];
  if (directUnit !== undefined) return { currency: 'EUR', unit: directUnit };

  const currency = SUFFIX_TO_CURRENCY[padded.slice(-1)];
  if (!currency) return null;
  const basePart = padToKnown(padded.slice(0, -1));
  const unit = OKEI_BASE_TO_UNIT[basePart];
  return unit !== undefined ? { currency, unit } : null;
}

/**
 * Дополнительная единица измерения кода ТН ВЭД (TNVED.EDI2/EDI3, графа 41 ДТ) —
 * чистый ОКЕИ-код без валютной составляющей: '715' → 'пар', '796' → 'шт'.
 * Возвращает null для пустых значений и кодов чистой валюты; нераспознанный
 * код возвращается как есть (мог прийти уже человекочитаемым).
 */
export function normalizeOkeiUnit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const padded = padToKnown(trimmed);
  if (OKEI_CURRENCY_ONLY[padded] !== undefined) return null;
  const unit = OKEI_BASE_TO_UNIT[padded];
  if (unit !== undefined) return unit || null;
  return trimmed;
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

/**
 * Чисто валютная ставка — фиксированная сумма в валюте без знаменателя (IMPEDI=500 "EUR" или 643 "RUB").
 * Семантически: абсолютная сумма X валюты за штуку/декларацию — редкое, но валидное значение TKS.
 */
export function isFlatCurrencyUnit(normalized: string | null | undefined): boolean {
  if (!normalized || normalized === '%' || normalized.includes('/')) return false;
  return KNOWN_CURRENCIES_SET.has(normalized.toUpperCase());
}

/**
 * Извлекает валюту из нормализованной строки IMPEDI.
 * "EUR/кг" → "EUR", "RUB" → "RUB", "%" → null, "м2" (единица без валюты) → null.
 */
export function extractCurrency(normalized: string | null | undefined): string | null {
  if (!normalized || normalized === '%') return null;
  const slash = normalized.indexOf('/');
  if (slash >= 0) return normalized.slice(0, slash);
  const upper = normalized.toUpperCase();
  return KNOWN_CURRENCIES_SET.has(upper) ? upper : null;
}
