import type { FreightCurrency } from '../database/entities/document.entity';

export interface NormalizedFreight {
  freightCost: number | null;
  freightCurrency: FreightCurrency | null;
}

/** Бросаем своим типом, чтобы вызывающая сторона (DocumentsService) сама решала,
 *  как обернуть в HTTP-ответ (BadRequestException + ErrorCode). Это держит helper
 *  свободным от зависимостей NestJS, упрощая unit-тесты. */
export class InvalidFreightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFreightError';
  }
}

/**
 * Приводит пару (freightCost, freightCurrency) к консистентной форме:
 * - cost > 0 без валюты → InvalidFreightError (валюта обязательна для конвертации);
 * - cost ≤ 0 / null / undefined → оба null, какой бы ни была валюта. Так «сброс
 *   фрахта» через freightCost=0 не падает, если в БД прилипла старая валюта.
 */
export function normalizeFreightInput(options: {
  freightCost?: number | null;
  freightCurrency?: FreightCurrency | null;
}): NormalizedFreight {
  const cost = options.freightCost;
  const currency = options.freightCurrency;
  const hasCost = cost !== undefined && cost !== null && cost > 0;
  if (!hasCost) return { freightCost: null, freightCurrency: null };
  if (currency == null) {
    throw new InvalidFreightError('freightCost is set but freightCurrency is missing');
  }
  return { freightCost: cost!, freightCurrency: currency };
}

/**
 * Конвертирует Document.freightCost из валюты фрахта в валюту документа,
 * используя предвычисленный `currencyToDoc` (см. CurrencyService.buildCurrencyToDocRates).
 * Возвращает null, если у документа фрахта нет или курс недоступен — вызывающая
 * сторона обычно логирует это и пропускает фрахт.
 */
export function resolveFreightTotalInDocCurrency(
  doc: { freightCost: number | null; freightCurrency: FreightCurrency | null },
  currencyToDoc: Record<string, number>,
): number | null {
  if (!doc.freightCost || doc.freightCost <= 0 || !doc.freightCurrency) {
    return null;
  }
  const rate = currencyToDoc[doc.freightCurrency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return doc.freightCost * rate;
}

/**
 * Вес-базис распределения фрахта одной строки: (вес за единицу × количество).
 * По Решению Коллегии ЕЭК № 83 перевозка распределяется пропорционально весу
 * БРУТТО — используем weightGross, когда парсер его извлёк; иначе fallback на
 * нетто (weight). Числитель и знаменатель распределения обязаны считаться этой
 * же функцией, иначе доли не сложатся в общий фрахт.
 */
export function freightWeightBasis(row: {
  weight?: number | null;
  weightGross?: number | null;
  quantity?: number | null;
}): number {
  const gross = Number(row.weightGross);
  const perUnit = Number.isFinite(gross) && gross > 0 ? gross : Number(row.weight) || 0;
  const total = perUnit * (Number(row.quantity) || 0);
  // Строки с нечисловым/бесконечным весом не получают долю фрахта в Calculator —
  // не включаем их и в знаменатель, иначе часть фрахта «испарится» из распределения.
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** Знаменатель для распределения фрахта: суммарный вес-базис (брутто, где есть)
 *  × количество по всем строкам. См. freightWeightBasis. */
export function computeWeightDenominator(
  rows: ReadonlyArray<{ weight?: number | null; weightGross?: number | null; quantity?: number | null }>,
): number {
  return rows.reduce((s, r) => s + freightWeightBasis(r), 0);
}
