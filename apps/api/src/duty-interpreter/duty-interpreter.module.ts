import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TksModule } from '../tks/tks.module';
import { DutyInterpreterService } from './duty-interpreter.service';

@Module({
  imports: [ConfigModule, TksModule],
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
