import { SetMetadata } from '@nestjs/common';

/**
 * Помечает endpoint как доступный ТОЛЬКО по X-Internal-Key (service-to-service,
 * напр. Telegram-бот). В отличие от обычных endpoint'ов, такие НЕ принимают JWT
 * любого пользователя: `JwtAuthGuard` для них требует валидный internal-key и
 * не пропускает по access-токену. Закрывает доступ к `*-internal`-маршрутам для
 * аутентифицированных, но не доверенных клиентов.
 */
export const IS_INTERNAL_KEY = 'isInternal';
export const Internal = () => SetMetadata(IS_INTERNAL_KEY, true);
