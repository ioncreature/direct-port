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

/** Знаменатель для распределения фрахта: суммарный вес × количество по всем строкам.
 *  Пользователь предпочитает брутто; если в parsedData брутто отсутствует, парсер
 *  должен класть нетто (тогда распределение чуть точнее по объёму) — обе схемы
 *  здесь равнозначны, helper'у важно только число. */
export function computeWeightDenominator(
  rows: ReadonlyArray<{ weight?: number | null; quantity?: number | null }>,
): number {
  return rows.reduce((s, r) => {
    const net = (Number(r.weight) || 0) * (Number(r.quantity) || 0);
    // Строки с нечисловым/бесконечным весом не получают долю фрахта в Calculator —
    // не включаем их и в знаменатель, иначе часть фрахта «испарится» из распределения.
    return Number.isFinite(net) && net > 0 ? s + net : s;
  }, 0);
}
