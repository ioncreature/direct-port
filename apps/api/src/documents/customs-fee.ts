/**
 * Сбор за таможенные операции при ввозе (графа 47, код платежа 1010) — лестница
 * ставок от общей таможенной стоимости товаров по одной ДТ.
 *
 * Ставки с 01.01.2026: ПП РФ № 1637 от 28.11.2024 в редакции ПП № 1638 от
 * 23.10.2025 (границы ступеней в тексте постановления — «не превышает N руб.
 * включительно»). Индексация неравномерная — ступени НЕ выводятся формулой.
 * Особые случаи (радиоэлектроника из спецперечня — фикс 73 860 ₽; ставки «по
 * количеству товаров», экспортная лестница) здесь сознательно не реализованы:
 * для оценки в «Проекте ДТ» достаточно базовой импортной лестницы.
 */

interface FeeStep {
  /** Верхняя граница таможенной стоимости ДТ в рублях (включительно). */
  upToRub: number;
  feeRub: number;
}

/** Импортная лестница с 01.01.2026 (ПП № 1637 в ред. № 1638). */
const FEE_LADDER_2026: FeeStep[] = [
  { upToRub: 200_000, feeRub: 1_231 },
  { upToRub: 450_000, feeRub: 2_462 },
  { upToRub: 1_200_000, feeRub: 4_924 },
  { upToRub: 2_700_000, feeRub: 13_541 },
  { upToRub: 4_200_000, feeRub: 18_465 },
  { upToRub: 5_500_000, feeRub: 21_344 },
  { upToRub: 10_000_000, feeRub: 49_240 },
  { upToRub: Infinity, feeRub: 73_860 },
];

export function estimateCustomsFeeRub(totalCustomsValueRub: number | null): number | null {
  if (totalCustomsValueRub == null || !Number.isFinite(totalCustomsValueRub)) return null;
  if (totalCustomsValueRub < 0) return null;
  for (const step of FEE_LADDER_2026) {
    if (totalCustomsValueRub <= step.upToRub) return step.feeRub;
  }
  return FEE_LADDER_2026[FEE_LADDER_2026.length - 1].feeRub;
}
