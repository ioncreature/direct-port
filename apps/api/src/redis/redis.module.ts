import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Тонкий общий ioredis-клиент для произвольных ключей (вне BullMQ).
 * Используется, например, для одноразовых токенов привязки менеджерского Telegram.
 * Глобальный — чтобы инжектить REDIS_CLIENT в любом модуле без повторного импорта.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get('REDIS_URL', 'redis://localhost:6380'), {
          // Fail-fast вместо вечного зависания: с offline queue команды при недоступном
          // Redis копились бы в памяти, и HTTP-запросы (bot-links на дашборде, генерация
          // токена привязки) висели до таймаута прокси. Ошибка сразу → внятный 500.
          // BullMQ-соединения это не касается — у них свой конфиг в BullModule.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 2,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
