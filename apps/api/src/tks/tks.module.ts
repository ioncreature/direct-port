import { TksApiClient } from '@direct-port/tks-api';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TksCache } from '../database/entities/tks-cache.entity';
import { PgTksCacheStore } from './pg-tks-cache.store';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([TksCache])],
  providers: [
    PgTksCacheStore,
    {
      provide: TksApiClient,
      inject: [ConfigService, PgTksCacheStore],
      useFactory: (config: ConfigService, cacheStore: PgTksCacheStore) => {
        const logger = new Logger('TksApiClient');
        return new TksApiClient({
          baseUrl: config.getOrThrow<string>('TKS_API_BASE_URL'),
          tnvedKey: config.getOrThrow<string>('TKS_TNVED_API_KEY'),
          goodsKey: config.getOrThrow<string>('TKS_GOODS_API_KEY'),
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
