import type { TksCacheStore } from '@direct-port/tks-api';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TksCache } from '../database/entities/tks-cache.entity';

type Category = 'goods' | 'tnved' | 'reference' | 'other';

const DEFAULT_TTL: Record<Category, number> = {
  goods: 30 * 24 * 60 * 60 * 1000, // 30 дней
  tnved: 7 * 24 * 60 * 60 * 1000, // 7 дней
  reference: 7 * 24 * 60 * 60 * 1000, // 7 дней
  other: 24 * 60 * 60 * 1000, // 24 часа
};

const CLEANUP_MULTIPLIER = 3;
const CLEANUP_PROBABILITY = 0.01;

@Injectable()
export class PgTksCacheStore implements TksCacheStore {
  private readonly logger = new Logger(PgTksCacheStore.name);
  private readonly ttls: Record<Category, number>;
  private readonly maxTtl: number;
  private lastStaleValue: { key: string; value: unknown } | null = null;

  constructor(
    @InjectRepository(TksCache) private repo: Repository<TksCache>,
    config: ConfigService,
  ) {
    this.ttls = {
      goods: this.resolveTtl(config, 'TKS_CACHE_TTL_GOODS_MS', DEFAULT_TTL.goods),
      tnved: this.resolveTtl(config, 'TKS_CACHE_TTL_TNVED_MS', DEFAULT_TTL.tnved),
      reference: this.resolveTtl(config, 'TKS_CACHE_TTL_REFERENCE_MS', DEFAULT_TTL.reference),
      other: this.resolveTtl(config, 'TKS_CACHE_TTL_OTHER_MS', DEFAULT_TTL.other),
    };
    this.maxTtl = Math.max(...Object.values(this.ttls));
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = await this.repo.findOne({ where: { key } });
    if (!entry) {
      this.lastStaleValue = null;
      return undefined;
    }

    const ttl = this.ttls[entry.category as Category] ?? this.ttls.other;
    const expiresAt = entry.fetchedAt.getTime() + ttl;
    if (Date.now() > expiresAt) {
      this.lastStaleValue = { key, value: entry.value };
      return undefined;
    }

    this.lastStaleValue = null;
    return entry.value as T;
  }

  async getStale<T>(key: string): Promise<T | undefined> {
    if (this.lastStaleValue?.key === key) {
      const value = this.lastStaleValue.value as T;
      this.lastStaleValue = null;
      return value;
    }
    const entry = await this.repo.findOne({ where: { key } });
    return entry ? (entry.value as T) : undefined;
  }

  async set<T>(key: string, value: T, _ttlMs: number): Promise<void> {
    const category = this.detectCategory(key);
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(TksCache)
      .values({ key, category, value: value as any, fetchedAt: new Date() })
      .orUpdate(['value', 'category', 'fetched_at'], ['key'])
      .execute();

    if (Math.random() < CLEANUP_PROBABILITY) {
      void this.cleanup().catch((err) => {
        this.logger.warn(`Cache cleanup failed: ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  async delete(key: string): Promise<void> {
    await this.repo.delete({ key });
  }

  async clear(): Promise<void> {
    await this.repo.clear();
  }

  private detectCategory(key: string): Category {
    if (key.includes('/goods.json/')) return 'goods';
    if (/\/\d{10}\.json/.test(key)) return 'tnved';
    if (key.includes('oksmt.json') || key.includes('ek_ar.json')) return 'reference';
    return 'other';
  }

  private async cleanup(): Promise<void> {
    const threshold = new Date(Date.now() - this.maxTtl * CLEANUP_MULTIPLIER);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(TksCache)
      .where('"fetched_at" < :threshold', { threshold })
      .execute();
    if (result.affected) {
      this.logger.log(`Cleaned up ${result.affected} stale cache entries`);
    }
  }

  private resolveTtl(config: ConfigService, envKey: string, fallback: number): number {
    const raw = config.get<string>(envKey);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
