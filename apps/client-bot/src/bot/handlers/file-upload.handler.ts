import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../../api-client/api-client.service';
import { ClientResolverService } from '../client-resolver.service';
import { formatUser } from '../format-user';
import { type BotContext, tErrorCode } from '../i18n';

const MAX_FILE_SIZE = 40 * 1024 * 1024;

@Injectable()
export class FileUploadHandler {
  private logger = new Logger(FileUploadHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private resolver: ClientResolverService,
  ) {}

  async handle(ctx: BotContext) {
    const document = ctx.message?.document;
    if (!document) return;

    const fileName = document.file_name || 'file';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const user = formatUser(ctx);

    // Не таблица (фото товара, pdf и т.п.) → релеим менеджеру как вложение, не как документ для расчёта.
    if (ext !== 'xlsx' && ext !== 'csv') {
      await this.relayAttachment(ctx, document.file_id);
      return;
    }

    if ((document.file_size ?? 0) > MAX_FILE_SIZE) {
      await ctx.reply(ctx.t('file-too-large'));
      return;
    }

    try {
      await ctx.reply(ctx.t('uploading'));
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());

      const telegramUserId = await this.resolver.resolveTelegramUserId(ctx);
      const result = await this.apiClient.intakeDocument(
        buffer,
        fileName,
        telegramUserId,
        document.file_id,
        ctx.message?.caption,
      );
      this.logger.log(
        `Intake "${fileName}" (${buffer.length}B) from ${user}: documentId=${result.id}`,
      );
      await ctx.reply(ctx.t('file-accepted', { fileName }));
    } catch (err) {
      this.logger.error(`Intake failed for "${fileName}" from ${user}: ${(err as Error).message}`);
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      await ctx.reply(tErrorCode(ctx.from?.language_code, code, 'upload-error'));
    }
  }

  private async relayAttachment(ctx: BotContext, fileId: string) {
    try {
      const telegramUserId = await this.resolver.resolveTelegramUserId(ctx);
      await this.apiClient.intakeMessage({
        telegramUserId,
        text: ctx.message?.caption,
        attachmentType: 'file',
        attachmentFileId: fileId,
        telegramMessageId: ctx.message?.message_id,
      });
      await ctx.reply(ctx.t('msg-received'));
    } catch (err) {
      this.logger.error(`Failed to relay file attachment: ${(err as Error).message}`);
      await ctx.reply(ctx.t('upload-error'));
    }
  }
}
