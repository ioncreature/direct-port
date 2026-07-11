import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from './auth/decorators/public.decorator';
import { REDIS_CLIENT } from './redis/redis.module';

@Controller()
export class AppController {
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
   * Readiness: под готов принимать трафик только при живых Postgres и Redis. При недоступности
   * зависимости k8s выводит под из endpoints (шеддинг нагрузки), НЕ убивая его. Раньше проба
   * висела на статической заглушке — под с мёртвой БД/Redis оставался Ready и отдавал 500.
   */
  @Public()
  @Get('health/ready')
  async readiness() {
    const [db, redis] = await Promise.all([
      this.check(() => this.dataSource.query('SELECT 1')),
      this.check(() => this.redis.ping()),
    ]);
    if (!db || !redis) {
      throw new HttpException(
        { status: 'unavailable', db, redis },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', db, redis };
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
