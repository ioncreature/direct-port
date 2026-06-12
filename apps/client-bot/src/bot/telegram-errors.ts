import { GrammyError } from 'grammy';

// Копия: совпадает с apps/manager-bot/src/bot/telegram-errors.ts (боты не делят
// grammy-зависимый код, см. format-user.ts) — правки синхронизировать.

/**
 * Ошибка доставки, которую повторная попытка не исправит: бот заблокирован адресатом
 * (Telegram 403), чат не найден / битый запрос (прочие 4xx), либо API ответил 4xx
 * (например, документ удалён). 429 и 5xx — временные, их имеет смысл ретраить;
 * сетевые ошибки (HttpError grammY, обрыв соединения axios) сюда не попадают
 * и тоже считаются временными.
 */
export function isPermanentDeliveryError(err: unknown): boolean {
  if (err instanceof GrammyError) {
    return err.error_code >= 400 && err.error_code < 500 && err.error_code !== 429;
  }
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number') {
    return status >= 400 && status < 500 && status !== 429;
  }
  return false;
}
