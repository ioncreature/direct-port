/**
 * Number(value), если это конечное положительное число; иначе undefined.
 * Для необязательных числовых полей из JSONB (weightGross и т. п.), где
 * null/0/мусор после ручной правки оператором означают «поля нет».
 */
export function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
