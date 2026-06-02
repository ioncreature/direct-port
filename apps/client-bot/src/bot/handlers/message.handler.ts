import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../../api-client/api-client.service';
import { ClientResolverService } from '../client-resolver.service';
import { type BotContext } from '../i18n';

/** Релей текстовых сообщений и фото от клиента менеджеру (через API-мост). */
@Injectable()
export class MessageHandler {
  private logger = new Logger(MessageHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private resolver: ClientResolverService,
  ) {}

  async handleText(ctx: BotContext) {
    const text = ctx.message?.text;
    if (!text) return;
    try {
      const telegramUserId = await this.resolver.resolveTelegramUserId(ctx);
      await this.apiClient.intakeMessage({
        telegramUserId,
        text,
        telegramMessageId: ctx.message?.message_id,
      });
      await ctx.reply(ctx.t('msg-received'));
    } catch (err) {
      this.logger.error(`Failed to relay text message: ${(err as Error).message}`);
    }
  }

  async handlePhoto(ctx: BotContext) {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;
    const fileId = photos[photos.length - 1].file_id; // самое крупное превью
    try {
      const telegramUserId = await this.resolver.resolveTelegramUserId(ctx);
      await this.apiClient.intakeMessage({
        telegramUserId,
        text: ctx.message?.caption,
        attachmentType: 'photo',
        attachmentFileId: fileId,
        telegramMessageId: ctx.message?.message_id,
      });
      await ctx.reply(ctx.t('msg-received'));
    } catch (err) {
      this.logger.error(`Failed to relay photo message: ${(err as Error).message}`);
    }
  }
}
