import { Injectable, Logger } from '@nestjs/common';
import { Context, Keyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class StartHandler {
  private logger = new Logger(StartHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: Context) {
    const from = ctx.from;
    if (!from) {
      this.logger.warn('/start received without "from" field');
      return;
    }

    try {
      const tgUser = await this.apiClient.registerTelegramUser({
        telegramId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
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
      });
    } catch (err) {
      this.logger.error(
        `Failed to register telegram user id=${from.id}: ${(err as Error).message}`,
      );
    }

    const keyboard = new Keyboard().text('📁 Загрузить файл').row().text('❓ Помощь').resized();

    await ctx.reply(
      'Добро пожаловать в DirectPort Bot!\n\n' +
        '• Загрузите файл с товарами (.xlsx или .csv)\n' +
        '• Выберите нужные столбцы\n' +
        '• Получите результат обработки\n\n' +
        'Выберите действие:',
      { reply_markup: keyboard },
    );
  }
}
