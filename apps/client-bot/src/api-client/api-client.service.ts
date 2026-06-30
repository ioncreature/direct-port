import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import FormData from 'form-data';

interface TimedRequestConfig extends InternalAxiosRequestConfig {
  metadata?: { startedAt: number };
}

export type AttachmentType = 'document' | 'photo' | 'file';

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

  async registerTelegramUser(payload: {
    telegramId: number;
    /** Компания бота, в который написал клиент (резолв по паре company+telegram на api). */
    companyId: string;
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

  /** Загрузка файла как managed-документа (без автозапуска пайплайна). */
  async intakeDocument(
    file: Buffer,
    fileName: string,
    telegramUserId: string,
    fileId?: string,
    text?: string,
  ): Promise<{ id: string; status: string }> {
    const form = new FormData();
    form.append('file', file, { filename: fileName });
    form.append('telegramUserId', telegramUserId);
    if (fileId) form.append('fileId', fileId);
    if (text) form.append('text', text);
    const { data } = await this.client.post('/intake/documents', form, {
      headers: form.getHeaders(),
      timeout: 15_000,
    });
    return data;
  }

  /** Скачать готовый Excel результата (download-internal) для доставки клиенту. */
  async downloadDocument(documentId: string): Promise<Buffer> {
    const { data } = await this.client.get(`/documents/${documentId}/download-internal`, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });
    return Buffer.from(data as ArrayBuffer);
  }

  /** Сообщение клиента менеджеру (текст и/или вложение). */
  async intakeMessage(payload: {
    telegramUserId: string;
    text?: string;
    attachmentType?: AttachmentType;
    attachmentFileId?: string;
    telegramMessageId?: number;
  }): Promise<void> {
    await this.client.post('/intake/messages', payload);
  }

  /** Публикация username бота для отображения ссылки в админке (при старте). */
  async publishBotIdentity(username: string): Promise<void> {
    await this.client.post('/bot-links/identity', { kind: 'client', username });
  }

  /**
   * Список клиентских ботов компаний (с расшифрованными токенами) для реестра. Дефолтный (env)
   * бот в ответ не входит — его поднимает сам бот из своего токена. См. docs/COMPANY_BOTS.md.
   */
  async listBots(): Promise<Array<{ companyId: string; token: string }>> {
    const { data } = await this.client.get('/internal/bots', { params: { kind: 'client' } });
    return data;
  }

  /** Привязка клиента к лиду по deep-link (?start=lead_<id>). Best-effort атрибуция. */
  async attachLeadClient(
    leadId: string,
    telegramUserId: string,
  ): Promise<{ linked: boolean; reason?: string }> {
    const { data } = await this.client.post(`/leads/${leadId}/attach-client`, { telegramUserId });
    return data;
  }
}
