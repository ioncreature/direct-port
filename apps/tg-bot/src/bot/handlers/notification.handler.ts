import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api, InputFile } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';

interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status: 'processed' | 'failed' | 'rejected';
  errorMessage?: string;
  rejectionReasons?: string[];
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

  async process(job: Job<DocumentNotification>): Promise<void> {
    const { documentId, telegramUserId, status, errorMessage, rejectionReasons } = job.data;
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
          : 'Файл не содержит данных, пригодных для оформления декларации.';

      await this.tgApi
        .sendMessage(
          chatId,
          `⛔ Документ не может быть обработан.\n\n` +
            `Причины:\n${reasonsList}\n\n` +
            `Исправьте файл и загрузите снова.`,
        )
        .catch((err) =>
          this.logger.error(`Failed to send rejection notification to ${chatId}`, err),
        );
      return;
    }

    if (status === 'failed') {
      await this.tgApi
        .sendMessage(
          chatId,
          `❌ Ошибка при обработке документа.\n${errorMessage ? `Причина: ${errorMessage}` : 'Попробуйте загрузить файл заново.'}`,
        )
        .catch((err) => this.logger.error(`Failed to send error notification to ${chatId}`, err));
      return;
    }

    try {
      const fileBuffer = await this.apiClient.downloadDocument(documentId);

      await this.tgApi.sendDocument(
        chatId,
        new InputFile(fileBuffer, `result_${documentId}.xlsx`),
        {
          caption:
            '✅ Документ обработан!\n\n' +
            'В файле добавлены столбцы:\n' +
            '• Код ТН ВЭД\n' +
            '• Ставки пошлины и НДС\n' +
            '• Суммы пошлины и НДС\n' +
            '• Комиссия за доставку\n' +
            '• Статус расчёта и замечания',
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send result for document ${documentId}`, err);
      await this.tgApi.sendMessage(
        chatId,
        '⚠️ Документ обработан, но не удалось отправить файл. Попробуйте позже.',
      );
    }
  }
}
