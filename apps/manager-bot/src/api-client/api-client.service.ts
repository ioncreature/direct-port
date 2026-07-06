import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

interface TimedRequestConfig extends InternalAxiosRequestConfig {
  metadata?: { startedAt: number };
}

export interface ClientSummary {
  id: string;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
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
      this.logger.log(`→ ${req.method?.toUpperCase()} ${req.baseURL ?? ''}${req.url ?? ''}`);
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

  async linkManager(telegramId: number, token: string): Promise<{ userId: string }> {
    const { data } = await this.client.post('/manager/link', { telegramId, token });
    return data;
  }

  async listClients(managerTelegramId: number): Promise<ClientSummary[]> {
    const { data } = await this.client.get('/manager/clients', {
      params: { managerTelegramId },
    });
    return data;
  }

  async claimClient(clientId: string, managerTelegramId: number): Promise<void> {
    await this.client.post(`/manager/clients/${clientId}/claim`, { managerTelegramId });
  }

  async sendMessage(managerTelegramId: number, clientId: string, text: string): Promise<void> {
    await this.client.post('/manager/messages', { managerTelegramId, clientId, text });
  }

  async startDocument(documentId: string, managerTelegramId: number): Promise<void> {
    await this.client.post(`/manager/documents/${documentId}/start`, { managerTelegramId });
  }

  async sendDocument(documentId: string, managerTelegramId: number): Promise<void> {
    await this.client.post(`/manager/documents/${documentId}/send-to-client`, {
      managerTelegramId,
    });
  }

  /** Подтвердить оплату заявки на пополнение → зачисление кредитов клиенту. */
  async confirmTopUp(topUpId: string, managerTelegramId: number): Promise<void> {
    await this.client.post(`/manager/topups/${topUpId}/confirm`, { managerTelegramId });
  }

  /** Отклонить неоплаченную заявку на пополнение. */
  async cancelTopUp(topUpId: string, managerTelegramId: number): Promise<void> {
    await this.client.post(`/manager/topups/${topUpId}/cancel`, { managerTelegramId });
  }

  /**
   * Список менеджерских ботов компаний (с расшифрованными токенами) для реестра — по одному на
   * компанию с заведённым токеном. См. docs/COMPANY_BOTS.md.
   */
  async listBots(): Promise<Array<{ companyId: string; token: string }>> {
    const { data } = await this.client.get('/internal/bots', { params: { kind: 'manager' } });
    return data;
  }
}
