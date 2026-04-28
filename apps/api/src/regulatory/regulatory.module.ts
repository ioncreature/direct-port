import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { CountriesModule } from '../countries/countries.module';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { RegulatoryInterpretationCache } from '../database/entities/regulatory-interpretation-cache.entity';
import { RegulatoryInterpreterService } from './regulatory-interpreter.service';
import { RegulatoryRequirementsService } from './regulatory-requirements.service';

@Module({
  imports: [
    CountriesModule,
    ConfigModule,
    AiConfigModule,
    TypeOrmModule.forFeature([RegulatoryInterpretationCache, AiUsageLog]),
  ],
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
    RegulatoryRequirementsService,
    RegulatoryInterpreterService,
  ],
  exports: [RegulatoryRequirementsService, RegulatoryInterpreterService],
})
export class RegulatoryModule {}
