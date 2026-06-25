import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

interface TimedRequestConfig extends InternalAxiosRequestConfig {
  metadata?: { startedAt: number };
}

/** Подмножество ответа api `/internal/client/resolve`, которое использует BFF. */
export interface ResolvedClient {
  telegramUserId: string;
  billingAccountId: string;
  firstName: string | null;
  username: string | null;
}

export interface PaginatedResult {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Тонкий клиент к apps/api (единственному владельцу БД/биллинга) по X-Internal-Key.
 * accountId всегда приходит из проверенного client-JWT и подставляется в путь —
 * api дополнительно проверяет принадлежность ресурса этому аккаунту.
 */
@Injectable()
export class ApiClientService {
  private logger = new Logger(ApiClientService.name);
  private client: AxiosInstance;

  constructor(config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get('API_BASE_URL', 'http://localhost:3001/api'),
      headers: { 'X-Internal-Key': config.get('API_INTERNAL_KEY', '') },
      timeout: 15_000,
    });

    this.client.interceptors.request.use((req: TimedRequestConfig) => {
      req.metadata = { startedAt: Date.now() };
      return req;
    });
    this.client.interceptors.response.use(
      (res) => {
        const req = res.config as TimedRequestConfig;
        const ms = req.metadata ? Date.now() - req.metadata.startedAt : 0;
        this.logger.log(`← ${req.method?.toUpperCase()} ${req.url ?? ''} ${res.status} ${ms}ms`);
        return res;
      },
      (err: AxiosError) => {
        const req = err.config as TimedRequestConfig | undefined;
        const status = err.response?.status ?? 'ERR';
        this.logger.error(`← ${req?.method?.toUpperCase()} ${req?.url ?? ''} ${status}: ${err.message}`);
        return Promise.reject(err);
      },
    );
  }

  /** Upsert клиента по Telegram identity → id для выдачи client-JWT. */
  async resolveClient(payload: {
    telegramId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    language?: string;
  }): Promise<ResolvedClient> {
    const { data } = await this.client.post('/internal/client/resolve', payload);
    return data;
  }

  async getBalance(accountId: string): Promise<{ balance: number }> {
    const { data } = await this.client.get(`/internal/client/${accountId}/balance`);
    return data;
  }

  async getTransactions(
    accountId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult> {
    const { data } = await this.client.get(`/internal/client/${accountId}/transactions`, {
      params: query,
    });
    return data;
  }

  async getDocuments(
    accountId: string,
    query: { page: number; limit: number; status?: string; sortBy?: string; sortOrder?: string },
  ): Promise<PaginatedResult> {
    const { data } = await this.client.get(`/internal/client/${accountId}/documents`, {
      params: query,
    });
    return data;
  }

  async getDocument(accountId: string, documentId: string): Promise<unknown> {
    const { data } = await this.client.get(
      `/internal/client/${accountId}/documents/${documentId}`,
    );
    return data;
  }

  async getPackages(): Promise<unknown> {
    const { data } = await this.client.get('/internal/client/packages');
    return data;
  }

  async createTopUp(
    accountId: string,
    payload: { packageKey: string; telegramUserId: string },
  ): Promise<unknown> {
    const { data } = await this.client.post(`/internal/client/${accountId}/topups`, payload);
    return data;
  }

  async getTopUps(
    accountId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult> {
    const { data } = await this.client.get(`/internal/client/${accountId}/topups`, {
      params: query,
    });
    return data;
  }

  async cancelTopUp(accountId: string, topUpId: string): Promise<unknown> {
    const { data } = await this.client.post(
      `/internal/client/${accountId}/topups/${topUpId}/cancel`,
      {},
    );
    return data;
  }

  /** Готовый Excel результата (бинарный поток + заголовки для проксирования в браузер). */
  async downloadDocument(
    accountId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; contentType: string; contentDisposition: string }> {
    const res = await this.client.get(
      `/internal/client/${accountId}/documents/${documentId}/download`,
      { responseType: 'arraybuffer', timeout: 30_000 },
    );
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      contentType:
        res.headers['content-type'] ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentDisposition: res.headers['content-disposition'] ?? 'attachment',
    };
  }
}
