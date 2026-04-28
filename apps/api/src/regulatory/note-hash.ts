import { createHash } from 'crypto';

/**
 * Стабильный 16-символьный hex-идентификатор записи RegulatoryItem. Включает в hash:
 *   - rawNote — основной отличающий фактор;
 *   - priznak + codeMin + countryCode — дисамбигуация для случаев одинакового NOTE
 *     (например, шаблонная преамбула «Внимание!..» в нескольких записях).
 * Используется и как ключ React-списка на фронте, и как идентификатор для merge
 * AI-выжимок из endpoint'а /tn-ved/:code/regulatory-explanations.
 */
export function computeItemId(
  priznak: number,
  codeMin: string,
  countryCode: string | null,
  note: string,
): string {
  return createHash('sha256')
    .update(`${priznak}\x00${codeMin}\x00${countryCode ?? ''}\x00${note}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Хеш только NOTE-текста — ключ кэша AI-выжимок. Одинаковый NOTE → одинаковый hash → одна выжимка.
 * Отличается от computeItemId: AI-выжимка не зависит от PRIZNAK/codeMin/CU,
 * только от текста — поэтому ключ кэша уже, чем itemId.
 */
export function noteHash(note: string): string {
  return createHash('sha256').update(note).digest('hex');
}
