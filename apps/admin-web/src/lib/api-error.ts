import { isAxiosError } from 'axios';

/**
 * Человекочитаемое сообщение из ошибки axios (в т.ч. массив `message` от валидации DTO) или Error.
 * Единый обработчик для форм/панелей админки — иначе копии `extractError`/`errMsg` расходятся.
 */
export function extractApiError(err: unknown): string {
  if (isAxiosError(err)) {
    const m = (err.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(m)) return m.join(', ');
    return m ?? err.message;
  }
  return err instanceof Error ? err.message : 'Ошибка';
}
