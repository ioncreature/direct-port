import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';

@Injectable()
export class StartHandler {
  private logger = new Logger(StartHandler.name);

  constructor(private apiClient: ApiClientService) {}

  async handle(ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    // grammy кладёт payload после /start (deep-link ?start=TOKEN) в ctx.match.
    const token = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!token) {
      await ctx.reply(
        'Это бот менеджера DirectPort. Чтобы привязать аккаунт, откройте ссылку привязки на странице менеджера в админке.',
      );
      return;
    }

    try {
      await this.apiClient.linkManager(from.id, token);
      await ctx.reply(
        '✅ Аккаунт привязан. Сюда будут приходить новые файлы и сообщения клиентов.\n/help — что умеет бот.',
      );
      this.logger.log(`Manager linked: telegramId=${from.id}`);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      const msg =
        code === 'INVALID_LINK_TOKEN'
          ? 'Ссылка привязки недействительна или истекла. Сгенерируйте новую в админке.'
          : 'Не удалось привязать аккаунт. Попробуйте позже.';
      await ctx.reply(msg);
      this.logger.error(`Link failed for telegramId=${from.id}: ${(err as Error).message}`);
    }
  }
}
