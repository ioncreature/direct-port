import { TksApiClient } from '@direct-port/tks-api';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TksApiClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('TksApiClient');
        return new TksApiClient({
          baseUrl: config.getOrThrow<string>('TKS_API_BASE_URL'),
          tnvedKey: config.getOrThrow<string>('TKS_TNVED_API_KEY'),
          goodsKey: config.getOrThrow<string>('TKS_GOODS_API_KEY'),
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
