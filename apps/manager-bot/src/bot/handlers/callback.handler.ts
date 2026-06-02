import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ActiveDialogService } from '../state/active-dialog.service';

interface ApiError {
  response?: { status?: number; data?: { code?: string } };
}

@Injectable()
export class CallbackHandler {
  private logger = new Logger(CallbackHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private activeDialog: ActiveDialogService,
  ) {}

  async handle(ctx: Context) {
    const data = ctx.callbackQuery?.data;
    const from = ctx.from;
    if (!data || !from) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }

    const sep = data.indexOf(':');
    const action = sep === -1 ? data : data.slice(0, sep);
    const arg = sep === -1 ? '' : data.slice(sep + 1);

    try {
      if (action === 'claim') {
        await this.apiClient.claimClient(arg, from.id);
        await ctx.answerCallbackQuery({ text: '✅ Клиент закреплён за вами' });
      } else if (action === 'start') {
        await this.apiClient.startDocument(arg, from.id);
        await ctx.answerCallbackQuery({ text: '🚀 Расчёт запущен' });
      } else if (action === 'reply') {
        await this.activeDialog.set(ctx.chat!.id, { clientId: arg, clientName: '' });
        await ctx.answerCallbackQuery({ text: '✍️ Режим ответа включён' });
        await ctx.reply('Отправьте текст — он уйдёт клиенту.');
      } else {
        await ctx.answerCallbackQuery().catch(() => undefined);
      }
    } catch (err) {
      await ctx
        .answerCallbackQuery({ text: this.describeError(err), show_alert: true })
        .catch(() => undefined);
      this.logger.warn(`Callback "${data}" failed: ${(err as Error).message}`);
    }
  }

  private describeError(err: unknown): string {
    const e = err as ApiError;
    const code = e.response?.data?.code;
    const status = e.response?.status;
    if (code === 'CLIENT_ALREADY_CLAIMED' || status === 409) {
      return 'Клиента уже взял другой менеджер';
    }
    if (code === 'MANAGER_NOT_LINKED' || status === 403) {
      return 'Ваш аккаунт не привязан. Отправьте /start с ссылкой из админки';
    }
    if (code === 'INVALID_STATUS_FOR_START') {
      return 'Документ уже запущен или не в статусе «Входящий»';
    }
    return 'Не удалось выполнить действие';
  }
}
