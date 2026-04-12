import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../../api-client/api-client.service';
import { formatUser } from '../format-user';
import { type BotContext, mapTelegramLocale } from '../i18n';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class FileUploadHandler {
  private logger = new Logger(FileUploadHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: BotContext) {
    const document = ctx.message?.document;
    if (!document) return;

    const fileName = document.file_name || 'file';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const user = formatUser(ctx);

    if (ext !== 'xlsx' && ext !== 'csv') {
      this.logger.warn(`Rejected unsupported file "${fileName}" (ext=${ext}) from ${user}`);
      await ctx.reply(ctx.t('unsupported-format'));
      return;
    }

    try {
      await ctx.reply(ctx.t('uploading'));

      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());

      let telegramUserId = (await this.stateService.getState(ctx.chat!.id))?.telegramUserId;

      if (!telegramUserId && ctx.from) {
        const language = mapTelegramLocale(ctx.from.language_code);
        const tgUser = await this.apiClient.registerTelegramUser({
          telegramId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          language,
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
          language,
        });
      }

      const uploadResult = await this.apiClient.uploadDocument(buffer, fileName, telegramUserId!);
      this.logger.log(
        `Uploaded "${fileName}" (${buffer.length}B) from ${user}: documentId=${uploadResult.id} status=${uploadResult.status}`,
      );

      await ctx.reply(ctx.t('file-accepted', { fileName }));
    } catch (err) {
      this.logger.error(`File upload failed for "${fileName}" from ${user}: ${(err as Error).message}`);
      const code = (err as any)?.response?.data?.code;
      const msgKey = code ? `error-${code}` : 'upload-error';
      await ctx.reply(ctx.t(msgKey));
    }
  }
}
