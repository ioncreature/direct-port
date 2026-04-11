import type {
  EkArArea,
  GoodsSearchResponse,
  OksmtCountry,
  TksApiLogger,
  TksApiOptions,
  TnvedCode,
  TnvedVersion,
} from './types';

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_SIZE = 1000;

interface CacheEntry<T> {
  data: Promise<T>;
  expiresAt: number;
}

export class TksApiClient {
  private readonly tnvedBase: string;
  private readonly goodsBase: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cacheEnabled: boolean;
  private readonly cacheTtl: number;
  private readonly cacheMaxSize: number;
  private readonly logger?: TksApiLogger;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(options: TksApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tnvedBase = `/tnved.json/json/${options.tnvedKey}`;
    this.goodsBase = `/goods.json/json/${options.goodsKey}`;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.cacheEnabled = options.cache !== false;
    this.cacheTtl = options.cacheTtl ?? DEFAULT_CACHE_TTL;
    this.cacheMaxSize = options.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE;
    this.logger = options.logger;
  }

  // --- TNVED API ---

  async getTnvedVersion(): Promise<TnvedVersion> {
    return this.fetchCached<TnvedVersion>(`${this.tnvedBase}/ver.json`);
  }

  async getTnvedCodeList(): Promise<string[]> {
    return this.fetchCached<string[]>(`${this.tnvedBase}/`);
  }

  /** Справка по 10-значному коду ТН ВЭД */
  async getTnvedCode(code: string): Promise<TnvedCode> {
    validateTnvedCode(code);
    return this.fetchCached<TnvedCode>(`${this.tnvedBase}/${code}.json`);
  }

  getTnvedArchiveUrl(): string {
    return `${this.baseUrl}${this.tnvedBase}/archive.zip`;
  }

  // --- GOODS API ---

  async searchGoods(query: string, options?: { page?: number }): Promise<GoodsSearchResponse> {
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
    return this.fetchCached<OksmtCountry[]>(`${this.tnvedBase}/oksmt.json`);
  }

  async getEconomicAreas(): Promise<EkArArea[]> {
    return this.fetchCached<EkArArea[]>(`${this.tnvedBase}/ek_ar.json`);
  }

  clearCache(code?: string): void {
    if (code) {
      this.cache.delete(`${this.tnvedBase}/${code}.json`);
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
    return this.fetch<GoodsSearchResponse>(`${this.goodsBase}/?${params}`);
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
    const startedAt = Date.now();

    this.logger?.log(`TKS API -> ${url}`);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout),
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if (this.logger) {
        const elapsed = Date.now() - startedAt;
        this.logger.error(
          `TKS API <- ${url} network error (${elapsed}ms): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

    const headersElapsed = Date.now() - startedAt;
    const contentType = response.headers.get('content-type') ?? '';

    if (this.logger) {
      const headers = Object.fromEntries(response.headers.entries());
      this.logger.log(
        `TKS API <- ${url} status=${response.status} ${response.statusText} (${headersElapsed}ms) headers=${JSON.stringify(headers)}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (this.logger) {
        const elapsed = Date.now() - startedAt;
        this.logger.error(
          `TKS API !! ${url} ${response.status} ${response.statusText} (${elapsed}ms) body=${body}`,
        );
      }
      throw new TksApiError(
        `TKS API error: ${response.status} ${response.statusText}`,
        response.status,
        url,
      );
    }

    // Читаем тело как текст, чтобы при невалидном JSON (например, HTML от WAF/Cloudflare)
    // залогировать сырой ответ и бросить читаемую TksApiError вместо SyntaxError из глубин json().
    const rawBody = await response.text();
    const elapsed = Date.now() - startedAt;

    try {
      const data = JSON.parse(rawBody) as T;
      this.logger?.log(`TKS API ok ${url} (${elapsed}ms) body=${rawBody}`);
      return data;
    } catch (err) {
      if (this.logger) {
        this.logger.error(
          `TKS API !! ${url} invalid JSON (${elapsed}ms) content-type=${contentType} body=${rawBody}`,
        );
      }
      throw new TksApiError(
        `TKS API returned invalid JSON (content-type: ${contentType}): ${err instanceof Error ? err.message : String(err)}`,
        response.status,
        url,
      );
    }
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
