import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api, InputFile } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { i18n } from '../i18n';

interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'failed' | 'rejected';
  errorMessage?: string;
  rejectionReasons?: string[];
  language?: string;
}

@Injectable()
@Processor('document-notifications')
export class NotificationHandler extends WorkerHost {
  private logger = new Logger(NotificationHandler.name);
  private tgApi: Api | null;

  constructor(
    config: ConfigService,
    private apiClient: ApiClientService,
  ) {
    super();
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.tgApi = token ? new Api(token) : null;
  }

  private t(lang: string | undefined, key: string, args?: Record<string, string>): string {
    return i18n.t(lang || 'en', key, args);
  }

  async process(job: Job<DocumentNotification>): Promise<void> {
    const { documentId, telegramUserId, status, errorMessage, rejectionReasons, language } =
      job.data;
    this.logger.log(`Notification for document ${documentId}: ${status}`);

    if (!this.tgApi) {
      this.logger.warn('Bot token not configured, skipping notification');
      return;
    }

    const chatId = telegramUserId;

    if (status === 'rejected') {
      const reasons = rejectionReasons ?? [];
      const reasonsList =
        reasons.length > 0
          ? reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
          : this.t(language, 'notif-rejected-default');

      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-rejected', { reasons: reasonsList }))
        .catch((err) =>
          this.logger.error(`Failed to send rejection notification to ${chatId}`, err),
        );
      return;
    }

    if (status === 'failed') {
      const detail = errorMessage
        ? errorMessage
        : this.t(language, 'notif-failed-retry');
      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-failed', { detail }))
        .catch((err) => this.logger.error(`Failed to send error notification to ${chatId}`, err));
      return;
    }

    try {
      const fileBuffer = await this.apiClient.downloadDocument(documentId);

      await this.tgApi.sendDocument(
        chatId,
        new InputFile(fileBuffer, `result_${documentId}.xlsx`),
        { caption: this.t(language, 'notif-success') },
      );
    } catch (err) {
      this.logger.error(`Failed to send result for document ${documentId}`, err);
      await this.tgApi.sendMessage(chatId, this.t(language, 'notif-send-failed'));
    }
  }
}
