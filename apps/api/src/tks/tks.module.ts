import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TksApiClient } from '@direct-port/tks-api';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TksApiClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new TksApiClient({
          tnvedKey: config.getOrThrow<string>('TKS_TNVED_API_KEY'),
          goodsKey: config.getOrThrow<string>('TKS_GOODS_API_KEY'),
        }),
    },
  ],
  exports: [TksApiClient],
})
export class TksModule {}
