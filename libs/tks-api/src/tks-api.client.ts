import { InMemoryTksCacheStore } from './in-memory-cache-store';
import type {
  EkArArea,
  GoodsSearchResponse,
  OksmtCountry,
  TksApiLogger,
  TksApiOptions,
  TksCacheStore,
  TnvedCode,
  TnvedVersion,
} from './types';

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_SIZE = 1000;
/** Префикс ключей кэша. Увеличить при несовместимых изменениях формата ответа. */
const CACHE_KEY_PREFIX = 'v1:';

export class TksApiClient {
  private readonly tnvedBase: string;
  private readonly goodsBase: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cacheEnabled: boolean;
  private readonly cacheTtl: number;
  private readonly cacheStore: TksCacheStore;
  private readonly logger?: TksApiLogger;
  /** Дедупликация одновременных запросов по одному ключу (thundering herd). */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: TksApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tnvedBase = `/tnved.json/json/${options.tnvedKey}`;
    this.goodsBase = `/goods.json/json/${options.goodsKey}`;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.cacheEnabled = options.cache !== false;
    this.cacheTtl = options.cacheTtl ?? DEFAULT_CACHE_TTL;
    this.cacheStore =
      options.cacheStore ?? new InMemoryTksCacheStore(options.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE);
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

  async clearCache(code?: string): Promise<void> {
    if (code) {
      await this.cacheStore.delete(this.cacheKey(`${this.tnvedBase}/${code}.json`));
    } else {
      // Сбрасываем in-flight, иначе текущий fetch запишет в store уже после clear.
      this.inFlight.clear();
      await this.cacheStore.clear();
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
    return this.fetchCached<GoodsSearchResponse>(`${this.goodsBase}/?${params}`);
  }

  private cacheKey(path: string): string {
    return `${CACHE_KEY_PREFIX}${path}`;
  }

  private async fetchCached<T>(path: string): Promise<T> {
    if (!this.cacheEnabled) {
      return this.fetch<T>(path);
    }

    const key = this.cacheKey(path);

    const cached = await this.cacheStore.get<T>(key).catch((err) => {
      this.logger?.error(
        `TKS API cache get failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    });
    if (cached !== undefined) {
      return cached;
    }

    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      try {
        const data = await this.fetch<T>(path);
        void this.cacheStore.set(key, data, this.cacheTtl).catch((err) => {
          this.logger?.error(
            `TKS API cache set failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        return data;
      } catch (fetchErr) {
        if (this.cacheStore.getStale) {
          const stale = await this.cacheStore.getStale<T>(key).catch(() => undefined);
          if (stale !== undefined) {
            this.logger?.error(
              `TKS API fetch failed for ${path}, using stale cache: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
            );
            return stale;
          }
        }
        throw fetchErr;
      }
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
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
