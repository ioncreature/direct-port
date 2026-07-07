/**
 * Неотрицательное целое из env: отсутствие/пустая строка/мусор → fallback.
 * Для «выключаемых» настроек 0 — валидное значение (означает «выключено»).
 */
export function readNonNegIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
