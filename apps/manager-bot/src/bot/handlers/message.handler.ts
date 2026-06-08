import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ActiveDialogService } from '../state/active-dialog.service';

/** Текст менеджера в активном диалоге → доставка клиенту. */
@Injectable()
export class MessageHandler {
  private logger = new Logger(MessageHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private activeDialog: ActiveDialogService,
  ) {}

  async handle(ctx: Context) {
    const from = ctx.from;
    const text = ctx.message?.text;
    if (!from || !text) return;

    const dialog = await this.activeDialog.get(ctx.chat!.id);
    if (!dialog) {
      await ctx.reply(
        'Сначала выберите клиента: нажмите «✍️ Ответить» под его сообщением или откройте /clients.',
      );
      return;
    }

    try {
      await this.apiClient.sendMessage(from.id, dialog.clientId, text);
      // Подтверждаем доставку один раз на диалог — дальше менеджер и так видит, что отвечает клиенту.
      if (await this.activeDialog.markAckedIfFirst(ctx.chat!.id)) {
        await ctx.reply('✅ Отправлено клиенту.');
      }
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      const msg =
        code === 'MANAGER_NOT_LINKED'
          ? 'Ваш аккаунт не привязан. Отправьте /start с ссылкой из админки.'
          : 'Не удалось отправить сообщение клиенту.';
      await ctx.reply(msg);
      this.logger.warn(`Manager reply failed: ${(err as Error).message}`);
    }
  }
}
