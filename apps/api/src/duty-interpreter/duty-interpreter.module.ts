import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { DutyInterpretationCache } from '../database/entities/duty-interpretation-cache.entity';
import { TksModule } from '../tks/tks.module';
import { DutyInterpreterService } from './duty-interpreter.service';

@Module({
  imports: [
    ConfigModule,
    TksModule,
    AiConfigModule,
    TypeOrmModule.forFeature([DutyInterpretationCache]),
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
    DutyInterpreterService,
  ],
  exports: [DutyInterpreterService],
})
export class DutyInterpreterModule {}
