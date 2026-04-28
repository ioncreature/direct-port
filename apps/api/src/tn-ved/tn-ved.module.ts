import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { CountriesModule } from '../countries/countries.module';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';
import { RegulatoryModule } from '../regulatory/regulatory.module';
import { TksModule } from '../tks/tks.module';
import { TnVedController } from './tn-ved.controller';
import { TnVedService } from './tn-ved.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TnVedCode, AiUsageLog]),
    ConfigModule,
    TksModule,
    CountriesModule,
    AiConfigModule,
    RegulatoryModule,
  ],
  controllers: [TnVedController],
  providers: [
    {
      provide: Anthropic,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) return null;
        return new Anthropic({ apiKey });
      },
    },
    TnVedService,
  ],
  exports: [TnVedService],
})
export class TnVedModule {}
