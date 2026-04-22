/** Нормализует OKSMT-код к 3-значной строке: "12" → "012", "  156 " → "156". null/"" → null. */
export function normalizeOksmtCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = String(code).trim().replace(/\D/g, '');
  if (!digits || digits.length > 3) return null;
  return digits.padStart(3, '0');
}
