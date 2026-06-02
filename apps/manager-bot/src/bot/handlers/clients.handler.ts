import { Injectable, Logger } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { formatClientName } from '../format';

@Injectable()
export class ClientsHandler {
  private logger = new Logger(ClientsHandler.name);

  constructor(private apiClient: ApiClientService) {}

  async handle(ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    try {
      const clients = await this.apiClient.listClients(from.id);
      if (clients.length === 0) {
        await ctx.reply('У вас пока нет закреплённых клиентов.');
        return;
      }
      for (const c of clients) {
        const kb = new InlineKeyboard().text('✍️ Ответить', `reply:${c.id}`);
        await ctx.reply(`👤 ${formatClientName(c)}`, { reply_markup: kb });
      }
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      const msg =
        code === 'MANAGER_NOT_LINKED'
          ? 'Ваш аккаунт не привязан. Откройте ссылку привязки в админке.'
          : 'Не удалось получить список клиентов.';
      await ctx.reply(msg);
      this.logger.warn(`/clients failed: ${(err as Error).message}`);
    }
  }
}
