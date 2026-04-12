import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { TksModule } from '../tks/tks.module';
import { ClassifierService } from './classifier.service';

@Module({
  imports: [ConfigModule, TksModule, AiConfigModule],
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
    ClassifierService,
  ],
  exports: [ClassifierService],
})
export class ClassifierModule {}
