import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from './auth/decorators/public.decorator';
import { REDIS_CLIENT } from './redis/redis.module';

@Controller()
export class AppController {
  private logger = new Logger(AppController.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  /**
   * Liveness: процесс жив и отвечает по HTTP. Намеренно НЕ ходит в БД/Redis — иначе
   * кратковременная недоступность зависимости рестартовала бы под, что зависимость не чинит,
   * а лишь усугубляет (заклиненный воркер как раз здесь и не поможет).
   */
  @Public()
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  /**
   * Readiness: под готов принимать трафик только при живом Postgres. При недоступности БД
   * k8s выводит под из endpoints (шеддинг нагрузки), НЕ убивая его. Раньше проба висела на
   * статической заглушке — под с мёртвой БД оставался Ready и отдавал 500.
   *
   * Redis проверяется, но readiness НЕ гейтит: весь остальной код относится к нему fail-open
   * (rate-limit пропускает, кэши и bot-links восстанавливаются), а вывод из endpoints ВСЕХ
   * реплик разом (Redis один на всех) превращал бы минутный блип в полный отказ API — включая
   * логин и работу с документами, которым Redis не нужен. Недоступность видна в payload пробы
   * (status=degraded) и warn-логе для алертинга; реально деградируют только очереди BullMQ.
   */
  @Public()
  @Get('health/ready')
  async readiness() {
    const [db, redis] = await Promise.all([
      this.check(() => this.dataSource.query('SELECT 1')),
      this.check(() => this.redis.ping()),
    ]);
    if (!db) {
      throw new HttpException(
        { status: 'unavailable', db, redis },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!redis) {
      this.logger.warn('Readiness: Redis unavailable — serving degraded (queues affected)');
    }
    return { status: redis ? 'ok' : 'degraded', db, redis };
  }

  private async check(probe: () => Promise<unknown>): Promise<boolean> {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }
}
