import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../../api-client/api-client.service';
import { ClientResolverService } from '../client-resolver.service';
import { type BotContext } from '../i18n';
import { ConversationStateService } from '../state/conversation-state.service';

/** Релей текстовых сообщений и фото от клиента менеджеру (через API-мост). */
@Injectable()
export class MessageHandler {
  private logger = new Logger(MessageHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private resolver: ClientResolverService,
    private stateService: ConversationStateService,
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
      await this.ackFirstContact(ctx);
    } catch (err) {
      this.logger.error(`Failed to relay text message: ${(err as Error).message}`);
      await this.replyRelayError(ctx);
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
      await this.ackFirstContact(ctx);
    } catch (err) {
      this.logger.error(`Failed to relay photo message: ${(err as Error).message}`);
      await this.replyRelayError(ctx);
    }
  }

  /**
   * Сообщение менеджеру не ушло (API недоступен) — клиент должен узнать об этом
   * сразу, иначе он уверен, что вопрос доставлен, а менеджер его никогда не увидит.
   * Файлы-вложения так уже делают (file-upload.handler) — текст и фото не должны
   * теряться тише.
   */
  private async replyRelayError(ctx: BotContext) {
    await ctx
      .reply(ctx.t('relay-error'))
      .catch((err) => this.logger.error(`Failed to notify client about relay error`, err));
  }

  /** Подтверждаем только первый контакт в сессии — дальше менеджер отвечает сам. */
  private async ackFirstContact(ctx: BotContext) {
    if (await this.stateService.markGreetedIfFirst(ctx.companyId, ctx.chat!.id)) {
      await ctx.reply(ctx.t('greeting-ack'));
    }
  }
}
