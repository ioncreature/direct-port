import type {
  TksApiOptions,
  TnvedCode,
  TnvedVersion,
  GoodsSearchResponse,
  OksmtCountry,
  EkArArea,
} from './types';

const DEFAULT_BASE_URL = 'https://api1.tks.ru';
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_SIZE = 1000;

interface CacheEntry<T> {
  data: Promise<T>;
  expiresAt: number;
}

export class TksApiClient {
  private readonly clientKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cacheEnabled: boolean;
  private readonly cacheTtl: number;
  private readonly cacheMaxSize: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(options: TksApiOptions) {
    this.clientKey = options.clientKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.cacheEnabled = options.cache !== false;
    this.cacheTtl = options.cacheTtl ?? DEFAULT_CACHE_TTL;
    this.cacheMaxSize = options.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE;
  }

  // --- TNVED API ---

  async getTnvedVersion(): Promise<TnvedVersion> {
    return this.fetchCached<TnvedVersion>(
      `/tnved.json/json/${this.clientKey}/ver.json`,
    );
  }

  async getTnvedCodeList(): Promise<string[]> {
    return this.fetchCached<string[]>(
      `/tnved.json/json/${this.clientKey}/`,
    );
  }

  /** Справка по 10-значному коду ТН ВЭД */
  async getTnvedCode(code: string): Promise<TnvedCode> {
    validateTnvedCode(code);
    return this.fetchCached<TnvedCode>(
      `/tnved.json/json/${this.clientKey}/${code}.json`,
    );
  }

  getTnvedArchiveUrl(): string {
    return `${this.baseUrl}/tnved.json/json/${this.clientKey}/archive.zip`;
  }

  // --- GOODS API ---

  async searchGoods(
    query: string,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    return this.searchGoodsInternal(query, undefined, options);
  }

  async searchGoodsGrouped(
    query: string,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    return this.searchGoodsInternal(query, { group: 'code' }, options);
  }

  async searchGoodsByCode(
    query: string,
    code: string,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    validateTnvedCode(code);
    return this.searchGoodsInternal(query, { code }, options);
  }

  // --- Справочники ---

  async getCountries(): Promise<OksmtCountry[]> {
    return this.fetchCached<OksmtCountry[]>(
      `/tnved.json/json/${this.clientKey}/oksmt.json`,
    );
  }

  async getEconomicAreas(): Promise<EkArArea[]> {
    return this.fetchCached<EkArArea[]>(
      `/tnved.json/json/${this.clientKey}/ek_ar.json`,
    );
  }

  clearCache(code?: string): void {
    if (code) {
      this.cache.delete(`/tnved.json/json/${this.clientKey}/${code}.json`);
    } else {
      this.cache.clear();
    }
  }

  // --- Internal ---

  private async searchGoodsInternal(
    query: string,
    extra?: Record<string, string>,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    const params = new URLSearchParams({ searchstr: query, ...extra });
    if (options?.page != null) {
      params.set('page', String(options.page));
    }
    return this.fetch<GoodsSearchResponse>(
      `/goods.json/json/${this.clientKey}/?${params}`,
    );
  }

  private fetchCached<T>(path: string): Promise<T> {
    if (this.cacheEnabled) {
      const cached = this.cache.get(path);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data as Promise<T>;
      }
    }

    const promise = this.fetch<T>(path);

    if (this.cacheEnabled) {
      this.evictIfNeeded();
      this.cache.set(path, { data: promise, expiresAt: Date.now() + this.cacheTtl });
      promise.catch(() => this.cache.delete(path));
    }

    return promise;
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.cacheMaxSize) return;
    // Удаляем просроченные записи
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    // Если всё ещё полон — удаляем самую старую запись (первый ключ в Map = oldest insertion)
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  private async fetch<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeout),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new TksApiError(
        `TKS API error: ${response.status} ${response.statusText}`,
        response.status,
        url,
      );
    }

    return response.json() as Promise<T>;
  }
}

export class TksApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'TksApiError';
  }
}

export function validateTnvedCode(code: string): void {
  if (!/^\d{10}$/.test(code)) {
    throw new Error(`Invalid TN VED code: expected 10 digits, got "${code}"`);
  }
}
