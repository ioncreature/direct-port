/**
 * Number(value), если это конечное положительное число; иначе undefined.
 * Для необязательных числовых полей из JSONB (weightGross и т. п.), где
 * null/0/мусор после ручной правки оператором означают «поля нет».
 */
export function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Округление до 4 знаков — общая точность величин parsedData (вес/цена/кол-во в доп. единице). */
export const round4 = (v: number): number => Math.round(v * 10000) / 10000;
