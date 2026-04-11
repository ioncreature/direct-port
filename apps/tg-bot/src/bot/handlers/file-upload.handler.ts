import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { formatUser } from '../format-user';
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
    const user = formatUser(ctx);

    if (ext !== 'xlsx' && ext !== 'csv') {
      this.logger.warn(`Rejected unsupported file "${fileName}" (ext=${ext}) from ${user}`);
      await ctx.reply('Поддерживаются только файлы .xlsx и .csv');
      return;
    }

    try {
      await ctx.reply('📥 Загружаю файл...');

      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());

      let telegramUserId = (await this.stateService.getState(ctx.chat!.id))?.telegramUserId;

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

      const uploadResult = await this.apiClient.uploadDocument(buffer, fileName, telegramUserId!);
      this.logger.log(
        `Uploaded "${fileName}" (${buffer.length}B) from ${user}: documentId=${uploadResult.id} status=${uploadResult.status}`,
      );

      await ctx.reply(
        `📄 Файл «${fileName}» принят в обработку.\n` + 'Вы получите уведомление по завершении.',
      );
    } catch (err) {
      this.logger.error(`File upload failed for "${fileName}" from ${user}: ${(err as Error).message}`);
      await ctx.reply('Ошибка при обработке файла. Попробуйте ещё раз.');
    }
  }
}
