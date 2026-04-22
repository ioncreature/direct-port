import { TksApiClient } from '@direct-port/tks-api';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { errMsg } from '../common/errors';
import { normalizeOksmtCode } from '../common/oksmt';
import { Country } from '../database/entities/country.entity';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CountriesService {
  private logger = new Logger(CountriesService.name);
  private memoCache: { list: Country[]; loadedAt: number } | null = null;
  private loadPromise: Promise<Country[]> | null = null;

  constructor(
    @InjectRepository(Country) private repo: Repository<Country>,
    private tksApi: TksApiClient,
  ) {}

  async listAll(): Promise<Country[]> {
    if (this.memoCache && Date.now() - this.memoCache.loadedAt < CACHE_TTL_MS) {
      return this.memoCache.list;
    }

    const cached = await this.repo.find({ order: { nameRu: 'ASC' } });
    if (cached.length > 0 && this.isFresh(cached[0].fetchedAt)) {
      this.memoize(cached);
      return cached;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.refreshFromTks(cached).finally(() => {
        this.loadPromise = null;
      });
    }
    try {
      return await this.loadPromise;
    } catch (err) {
      this.logger.warn(`Countries refresh failed, falling back to stale cache: ${errMsg(err)}`);
      if (cached.length > 0) {
        this.memoize(cached);
        return cached;
      }
      throw err;
    }
  }

  async findByCode(code: string | null | undefined): Promise<Country | null> {
    const normalized = normalizeOksmtCode(code);
    if (!normalized) return null;
    const list = await this.listAll();
    return list.find((c) => c.code === normalized) ?? null;
  }

  private isFresh(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() < CACHE_TTL_MS;
  }

  private memoize(list: Country[]): void {
    this.memoCache = { list, loadedAt: Date.now() };
  }

  private async refreshFromTks(fallback: Country[]): Promise<Country[]> {
    this.logger.log('Refreshing countries from TKS');
    const raw = await this.tksApi.getCountries();

    const entities: Country[] = raw
      .map((r): Country | null => {
        const code = normalizeOksmtCode(r.KOD);
        if (!code) return null;
        const e = new Country();
        e.code = code;
        e.alpha2 = r.ABC2?.trim() || null;
        e.alpha3 = r.ABC3?.trim() || null;
        e.nameRu = (r.KRNAIM || r.NAIM || r.ANAIM || r.KOD).trim();
        e.nameFullRu = r.NAIM?.trim() || null;
        e.nameEn = r.ANAIM?.trim() || null;
        e.fetchedAt = new Date();
        return e;
      })
      .filter((e): e is Country => e !== null);

    if (entities.length === 0) {
      this.logger.warn('TKS returned empty countries list, keeping existing cache');
      this.memoize(fallback);
      return fallback;
    }

    await this.repo.upsert(entities, ['code']);
    const sorted = [...entities].sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
    this.memoize(sorted);
    this.logger.log(`Countries cache refreshed: ${entities.length} entries`);
    return sorted;
  }
}
