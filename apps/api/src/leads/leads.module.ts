import Anthropic from '@anthropic-ai/sdk';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { ManagerNotifyModule } from '../conversations/manager-notify.module';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { Lead } from '../database/entities/lead.entity';
import { LeadSearch } from '../database/entities/lead-search.entity';
import { LeadDiscoveryProcessor } from './lead-discovery.processor';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadEnrichmentProcessor } from './lead-enrichment.processor';
import { LeadEnrichmentService } from './lead-enrichment.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadSearch, AiUsageLog]),
    BullModule.registerQueue({ name: 'lead-discovery' }),
    BullModule.registerQueue({ name: 'lead-enrichment' }),
    ConfigModule,
    AiConfigModule,
    ManagerNotifyModule,
  ],
  controllers: [LeadsController],
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
    LeadsService,
    LeadDiscoveryService,
    LeadEnrichmentService,
    LeadDiscoveryProcessor,
    LeadEnrichmentProcessor,
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
