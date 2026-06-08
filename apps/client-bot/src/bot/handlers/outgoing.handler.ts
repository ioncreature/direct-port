import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api, InputFile } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { i18n } from '../i18n';

// Wire-format: совпадает с ClientOutgoingMessage в apps/api/src/conversations/client-outgoing.ts.
interface ClientOutgoingMessage {
  clientTelegramId: string;
  language?: string;
  text?: string;
  documentId?: string;
  documentFileName?: string;
  i18nKey?: string;
}

/** Доставляет клиенту ответы менеджера (очередь client-bot-outgoing): текст или готовый расчёт. */
@Injectable()
@Processor('client-bot-outgoing')
export class OutgoingHandler extends WorkerHost {
  private logger = new Logger(OutgoingHandler.name);
  private tgApi: Api | null;

  constructor(
    config: ConfigService,
    private apiClient: ApiClientService,
  ) {
    super();
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.tgApi = token ? new Api(token) : null;
  }

  async process(job: Job<ClientOutgoingMessage>): Promise<void> {
    const { clientTelegramId, text, documentId, documentFileName, language, i18nKey } = job.data;
    if (!this.tgApi) {
      this.logger.warn('Bot token not configured, skipping outgoing message');
      return;
    }
    if (documentId) {
      await this.deliverDocument(this.tgApi, clientTelegramId, documentId, documentFileName, language);
      return;
    }
    // Системные уведомления приходят ключом локали — переводим их на язык клиента здесь.
    const body = i18nKey ? i18n.t(language ?? 'ru', i18nKey) : text;
    if (!body) return;
    await this.tgApi
      .sendMessage(clientTelegramId, body)
      .catch((err) =>
        this.logger.error(`Failed to deliver manager message to ${clientTelegramId}`, err),
      );
  }

  /** Скачивает Excel результата из API и отправляет клиенту как документ с локализованной подписью. */
  private async deliverDocument(
    api: Api,
    clientTelegramId: string,
    documentId: string,
    fileName: string | undefined,
    language: string | undefined,
  ): Promise<void> {
    try {
      const buffer = await this.apiClient.downloadDocument(documentId);
      const caption = i18n.t(language ?? 'ru', 'result-ready');
      await api.sendDocument(clientTelegramId, new InputFile(buffer, fileName ?? 'result.xlsx'), {
        caption,
      });
    } catch (err) {
      this.logger.error(`Failed to deliver result document to ${clientTelegramId}`, err);
    }
  }
}
