import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api } from 'grammy';

// Wire-format: совпадает с ClientOutgoingMessage в apps/api/src/conversations/client-outgoing.ts.
interface ClientOutgoingMessage {
  clientTelegramId: string;
  text: string;
  language?: string;
}

/** Доставляет ответы менеджера клиенту (очередь client-bot-outgoing). */
@Injectable()
@Processor('client-bot-outgoing')
export class OutgoingHandler extends WorkerHost {
  private logger = new Logger(OutgoingHandler.name);
  private tgApi: Api | null;

  constructor(config: ConfigService) {
    super();
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.tgApi = token ? new Api(token) : null;
  }

  async process(job: Job<ClientOutgoingMessage>): Promise<void> {
    const { clientTelegramId, text } = job.data;
    if (!this.tgApi) {
      this.logger.warn('Bot token not configured, skipping outgoing message');
      return;
    }
    await this.tgApi
      .sendMessage(clientTelegramId, text)
      .catch((err) =>
        this.logger.error(`Failed to deliver manager message to ${clientTelegramId}`, err),
      );
  }
}
