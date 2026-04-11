import type { TksCacheStore } from '@direct-port/tks-api';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Redis-реализация TksCacheStore: ключи сериализуются в JSON, TTL задаётся через PX.
 * Пространство ключей изолировано префиксом, чтобы clear() мог чистить только TKS-записи.
 */
@Injectable()
export class RedisTksCacheStore implements TksCacheStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisTksCacheStore.name);
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.keyPrefix = config.get<string>('TKS_CACHE_KEY_PREFIX', 'tks:');
    this.redis = new Redis(url, {
      // Не блокируем старт приложения, если Redis временно недоступен:
      // промахи в get/set будут поглощены try/catch в TksApiClient.
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => {
      this.redis.disconnect();
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.prefixed(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      // Битая запись: самоочистка без блокировки вызывающего.
      this.logger.warn(
        `Invalid cache payload for ${key}, removing: ${err instanceof Error ? err.message : String(err)}`,
      );
      void this.redis.del(this.prefixed(key)).catch(() => undefined);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.redis.set(this.prefixed(key), JSON.stringify(value), 'PX', ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.prefixed(key));
  }

  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    const stream = this.redis.scanStream({ match: pattern, count: 200 });
    const pipeline = this.redis.pipeline();
    let pending = 0;
    for await (const keys of stream as AsyncIterable<string[]>) {
      for (const key of keys) {
        pipeline.del(key);
        pending++;
      }
    }
    if (pending > 0) {
      await pipeline.exec();
    }
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
