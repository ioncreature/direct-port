import { Controller, Get, Header } from '@nestjs/common';
import { Internal } from '../auth/decorators/internal.decorator';
import { MetricsService } from './metrics.service';

/**
 * Метрики очередей для Prometheus/дашбордов. Доступ ТОЛЬКО по X-Internal-Key (@Internal):
 * счётчики очередей — операционная инфа, наружу её светить незачем. Prometheus-скрейпер
 * прокидывает internal-key заголовком в scrape-конфиге.
 */
@Controller('internal/metrics')
export class MetricsController {
  constructor(private metrics: MetricsService) {}

  @Get()
  @Internal()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  prometheus(): Promise<string> {
    return this.metrics.toPrometheus();
  }
}
