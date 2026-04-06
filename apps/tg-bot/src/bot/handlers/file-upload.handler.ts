import { Injectable, Logger } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { ExcelService } from '../../excel/excel.service';
import { ApiClientService } from '../../api-client/api-client.service';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class FileUploadHandler {
  private logger = new Logger(FileUploadHandler.name);

  constructor(
    private excelService: ExcelService,
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

    const fileType = ext as 'xlsx' | 'csv';

    try {
      await ctx.reply('Загружаю файл...');

      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());

      const headers = await this.excelService.getFileHeaders(buffer, fileType);

      if (headers.length < 2) {
        await ctx.reply('Файл не содержит достаточно столбцов. Проверьте формат.');
        return;
      }

      // Ensure user is registered
      let state = await this.stateService.getState(ctx.chat!.id);
      if (!state?.telegramUserId && ctx.from) {
        const tgUser = await this.apiClient.registerTelegramUser({
          telegramId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        });
        state = {
          step: 'idle',
          fileBuffer: '',
          fileName: '',
          fileType: 'xlsx',
          headers: [],
          columnMapping: {},
          telegramUserId: tgUser.id,
        };
      }

      await this.stateService.setState(ctx.chat!.id, {
        ...state!,
        step: 'awaiting_column_description',
        fileBuffer: buffer.toString('base64'),
        fileName,
        fileType,
        headers,
        columnMapping: {},
      });

      const kb = new InlineKeyboard();
      headers.forEach((header, index) => {
        kb.text(header, `col_description_${index}`).row();
      });

      await ctx.reply('Выберите столбец с наименованием товара:', {
        reply_markup: kb,
      });
    } catch (err) {
      this.logger.error('File upload error', err);
      await ctx.reply('Ошибка при обработке файла. Попробуйте ещё раз.');
    }
  }
}
