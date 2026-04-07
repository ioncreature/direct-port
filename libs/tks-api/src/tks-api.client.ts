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

export class TksApiClient {
  private readonly clientKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: TksApiOptions) {
    this.clientKey = options.clientKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  // --- TNVED API ---

  /** Текущая версия справочника ТН ВЭД */
  async getTnvedVersion(): Promise<TnvedVersion> {
    return this.fetch<TnvedVersion>(
      `/tnved.json/json/${this.clientKey}/ver.json`,
    );
  }

  /** Список всех кодов ТН ВЭД */
  async getTnvedCodeList(): Promise<string[]> {
    return this.fetch<string[]>(
      `/tnved.json/json/${this.clientKey}/`,
    );
  }

  /** Справка по товару по 10-значному коду ТН ВЭД */
  async getTnvedCode(code: string): Promise<TnvedCode> {
    this.validateTnvedCode(code);
    return this.fetch<TnvedCode>(
      `/tnved.json/json/${this.clientKey}/${code}.json`,
    );
  }

  /** URL для скачивания ZIP-архива всех кодов */
  getTnvedArchiveUrl(): string {
    return `${this.baseUrl}/tnved.json/json/${this.clientKey}/archive.zip`;
  }

  // --- GOODS API ---

  /** Поиск товаров по текстовому запросу */
  async searchGoods(
    query: string,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    const params = new URLSearchParams({ searchstr: query });
    if (options?.page) {
      params.set('page', String(options.page));
    }
    return this.fetch<GoodsSearchResponse>(
      `/goods.json/json/${this.clientKey}/?${params}`,
    );
  }

  /** Поиск товаров с группировкой по коду ТН ВЭД */
  async searchGoodsGrouped(
    query: string,
    options?: { page?: number },
  ): Promise<GoodsSearchResponse> {
    const params = new URLSearchParams({
      searchstr: query,
      group: 'code',
    });
    if (options?.page) {
      params.set('page', String(options.page));
    }
    return this.fetch<GoodsSearchResponse>(
      `/goods.json/json/${this.clientKey}/?${params}`,
    );
  }

  // --- Справочники ---

  /** Справочник стран (ОКСМТ) */
  async getCountries(): Promise<OksmtCountry[]> {
    return this.fetch<OksmtCountry[]>(
      `/tnved.json/json/${this.clientKey}/oksmt.json`,
    );
  }

  /** Справочник экономических зон */
  async getEconomicAreas(): Promise<EkArArea[]> {
    return this.fetch<EkArArea[]>(
      `/tnved.json/json/${this.clientKey}/ek_ar.json`,
    );
  }

  // --- Internal ---

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

  private validateTnvedCode(code: string): void {
    if (!/^\d{10}$/.test(code)) {
      throw new Error(`Invalid TN VED code: expected 10 digits, got "${code}"`);
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
