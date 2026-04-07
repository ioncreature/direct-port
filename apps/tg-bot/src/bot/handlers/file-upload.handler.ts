import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class FileUploadHandler {
  private logger = new Logger(FileUploadHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: Context) {
    const document = ctx.message?.document;
    if (!document) return;

    const fileName = document.file_name || 'file';
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext !== 'xlsx' && ext !== 'csv') {
      await ctx.reply('Поддерживаются только файлы .xlsx и .csv');
      return;
    }

    try {
      await ctx.reply('📥 Загружаю файл и анализирую... Это может занять до 30 секунд.');

      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Ensure user is registered
      let telegramUserId: string | undefined;
      const state = await this.stateService.getState(ctx.chat!.id);
      telegramUserId = state?.telegramUserId;

      if (!telegramUserId && ctx.from) {
        const tgUser = await this.apiClient.registerTelegramUser({
          telegramId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        });
        telegramUserId = tgUser.id;
        await this.stateService.setState(ctx.chat!.id, {
          step: 'idle',
          fileBuffer: '',
          fileName: '',
          fileType: 'xlsx',
          headers: [],
          columnMapping: {},
          telegramUserId,
        });
      }

      await this.apiClient.uploadDocument(buffer, fileName, telegramUserId!);

      await ctx.reply(
        `📄 Файл «${fileName}» принят в обработку.\n` +
          'Вы получите уведомление по завершении.',
      );
    } catch (err) {
      this.logger.error('File upload error', err);
      await ctx.reply('Ошибка при обработке файла. Попробуйте ещё раз.');
    }
  }
}
