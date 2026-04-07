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
          clientKey: config.getOrThrow<string>('TKS_API_KEY'),
        }),
    },
  ],
  exports: [TksApiClient],
})
export class TksModule {}
