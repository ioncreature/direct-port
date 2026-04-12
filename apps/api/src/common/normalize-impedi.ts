// TKS API иногда возвращает IMPEDI2 как числовой код ОКЕИ ("166") вместо "EUR/кг"
const OKEI_TO_UNIT: Record<string, string> = {
  '006': 'м',
  '055': 'м²',
  '112': 'л',
  '113': 'м³',
  '163': 'г',
  '166': 'кг',
  '168': 'т',
  '796': 'шт',
};

export function normalizeImpediUnit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.includes('/')) return raw;

  const unit = OKEI_TO_UNIT[raw.trim()];
  return unit ? `EUR/${unit}` : raw;
}
