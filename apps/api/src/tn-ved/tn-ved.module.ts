import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';
import { TksModule } from '../tks/tks.module';
import { TnVedController } from './tn-ved.controller';
import { TnVedService } from './tn-ved.service';

@Module({
  imports: [TypeOrmModule.forFeature([TnVedCode]), ConfigModule, TksModule],
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
