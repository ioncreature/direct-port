import { Injectable, Logger } from '@nestjs/common';
import { Keyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { type BotContext, mapTelegramLocale } from '../i18n';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class StartHandler {
  private logger = new Logger(StartHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: BotContext) {
    const from = ctx.from;
    if (!from) {
      this.logger.warn('/start received without "from" field');
      return;
    }

    const language = mapTelegramLocale(from.language_code);
    ctx.i18n.useLocale(language);

    try {
      const tgUser = await this.apiClient.registerTelegramUser({
        telegramId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        language,
      });
      this.logger.log(`Registered telegram user: internalId=${tgUser.id} telegramId=${from.id}`);

      await this.stateService.setState(ctx.chat!.id, {
        step: 'idle',
        fileBuffer: '',
        fileName: '',
        fileType: 'xlsx',
        headers: [],
        columnMapping: {},
        telegramUserId: tgUser.id,
        language,
      });
    } catch (err) {
      this.logger.error(
        `Failed to register telegram user id=${from.id}: ${(err as Error).message}`,
      );
    }

    const keyboard = new Keyboard()
      .text(ctx.t('btn-upload'))
      .row()
      .text(ctx.t('btn-help'))
      .resized();

    await ctx.reply(ctx.t('welcome'), { reply_markup: keyboard });
  }
}
