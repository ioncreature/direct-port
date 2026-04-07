import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SpreadsheetReaderService } from './spreadsheet-reader.service';
import { AiParserService } from './ai-parser.service';

@Module({
  imports: [ConfigModule],
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
