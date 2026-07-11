import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Видимость очередей BullMQ (см. MetricsService). Регистрирует те же очереди, что и
 * доменные модули — это отдельные Queue-клиенты к тем же ключам Redis (чтение счётчиков),
 * доменную логику не дублируют.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'document-parsing' },
      { name: 'document-processing' },
      { name: 'manager-notifications' },
      { name: 'client-bot-outgoing' },
      { name: 'lead-discovery' },
      { name: 'lead-enrichment' },
    ),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
