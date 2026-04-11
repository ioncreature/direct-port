import { TksApiClient } from '@direct-port/tks-api';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisTksCacheStore } from './redis-tks-cache.store';

const DEFAULT_TKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function resolveCacheTtl(config: ConfigService): number {
  const raw = config.get<string>('TKS_CACHE_TTL_MS');
  if (!raw) return DEFAULT_TKS_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TKS_CACHE_TTL_MS;
}

@Module({
  imports: [ConfigModule],
  providers: [
    RedisTksCacheStore,
    {
      provide: TksApiClient,
      inject: [ConfigService, RedisTksCacheStore],
      useFactory: (config: ConfigService, cacheStore: RedisTksCacheStore) => {
        const logger = new Logger('TksApiClient');
        return new TksApiClient({
          baseUrl: config.getOrThrow<string>('TKS_API_BASE_URL'),
          tnvedKey: config.getOrThrow<string>('TKS_TNVED_API_KEY'),
          goodsKey: config.getOrThrow<string>('TKS_GOODS_API_KEY'),
          cacheTtl: resolveCacheTtl(config),
          cacheStore,
          logger: {
            log: (message) => logger.log(message),
            error: (message) => logger.error(message),
          },
        });
      },
    },
  ],
  exports: [TksApiClient],
})
export class TksModule {}
