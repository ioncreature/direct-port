import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { AiParserService } from './ai-parser.service';
import { SpreadsheetReaderService } from './spreadsheet-reader.service';

@Module({
  imports: [ConfigModule, AiConfigModule],
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
    SpreadsheetReaderService,
    AiParserService,
  ],
  exports: [AiParserService],
})
export class AiParserModule {}
