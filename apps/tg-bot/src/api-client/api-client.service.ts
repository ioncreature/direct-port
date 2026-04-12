import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import FormData from 'form-data';

interface TimedRequestConfig extends InternalAxiosRequestConfig {
  metadata?: { startedAt: number };
}

@Injectable()
export class ApiClientService {
  private logger = new Logger(ApiClientService.name);
  private client: AxiosInstance;

  constructor(config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get('API_BASE_URL', 'http://localhost:3001/api'),
      headers: {
        'X-Internal-Key': config.get('API_INTERNAL_KEY', ''),
      },
    });

    this.client.interceptors.request.use((req: TimedRequestConfig) => {
      req.metadata = { startedAt: Date.now() };
      this.logger.log(
        `→ ${req.method?.toUpperCase()} ${req.baseURL ?? ''}${req.url ?? ''}`,
      );
      return req;
    });

    this.client.interceptors.response.use(
      (res) => {
        const req = res.config as TimedRequestConfig;
        const ms = req.metadata ? Date.now() - req.metadata.startedAt : 0;
        this.logger.log(
          `← ${req.method?.toUpperCase()} ${req.url ?? ''} ${res.status} ${ms}ms`,
        );
        return res;
      },
      (err: AxiosError) => {
        const req = err.config as TimedRequestConfig | undefined;
        const ms = req?.metadata ? Date.now() - req.metadata.startedAt : 0;
        const status = err.response?.status ?? 'ERR';
        const method = req?.method?.toUpperCase() ?? 'REQ';
        const url = req?.url ?? '';
        const body =
          err.response?.data && typeof err.response.data === 'object'
            ? JSON.stringify(err.response.data).slice(0, 300)
            : String(err.response?.data ?? '');
        this.logger.error(
          `← ${method} ${url} ${status} ${ms}ms: ${err.message}${body ? ' | ' + body : ''}`,
        );
        return Promise.reject(err);
      },
    );
  }

  async searchTnVed(query: string) {
    const { data } = await this.client.get('/tn-ved', { params: { search: query } });
    return data as TnVedResult[];
  }

  async logCalculation(payload: CalculationLogPayload) {
    await this.client.post('/calculation-logs', payload).catch(() => {});
  }

  async registerTelegramUser(payload: {
    telegramId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    language?: string;
  }): Promise<{ id: string; telegramId: string; language: string }> {
    const { data } = await this.client.post('/telegram-users/register', payload);
    return data;
  }

  async updateUserLanguage(telegramId: number, language: string): Promise<void> {
    await this.client.patch(`/telegram-users/${telegramId}/language`, { language });
  }

  async createDocument(payload: {
    telegramUserId: string;
    originalFileName: string;
    columnMapping: Record<string, number>;
    parsedData: Record<string, unknown>[];
  }): Promise<{ id: string; status: string }> {
    const { data } = await this.client.post('/documents', payload);
    return data;
  }

  async uploadDocument(
    file: Buffer,
    fileName: string,
    telegramUserId: string,
  ): Promise<{ id: string; status: string }> {
    const form = new FormData();
    form.append('file', file, { filename: fileName });
    form.append('telegramUserId', telegramUserId);
    const { data } = await this.client.post('/documents/upload', form, {
      headers: form.getHeaders(),
      timeout: 15_000,
    });
    return data;
  }

  async downloadDocument(documentId: string): Promise<Buffer> {
    const { data } = await this.client.get(`/documents/${documentId}/download-internal`, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(data);
  }
}

export interface TnVedResult {
  code: string;
  description: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
}

export interface CalculationLogPayload {
  telegramUserId: number;
  telegramUsername?: string;
  fileName?: string;
  itemsCount: number;
  resultSummary: Record<string, unknown>;
}
