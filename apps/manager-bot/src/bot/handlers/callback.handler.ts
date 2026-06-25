import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ActiveDialogService } from '../state/active-dialog.service';

interface ApiError {
  response?: { status?: number; data?: { code?: string } };
}

/** Машинный код/статус ошибки API → текст для toast менеджеру. */
export function describeCallbackError(err: unknown): string {
  const e = err as ApiError;
  const code = e.response?.data?.code;
  const status = e.response?.status;
  if (code === 'CLIENT_ALREADY_CLAIMED' || status === 409) {
    return 'Клиента уже взял другой менеджер';
  }
  if (code === 'CLIENT_NOT_ASSIGNED') {
    return 'Клиент закреплён за другим менеджером (или ещё не взят — нажмите «👤 Взять»)';
  }
  if (code === 'MANAGER_NOT_LINKED' || status === 403) {
    return 'Ваш аккаунт не привязан. Отправьте /start с ссылкой из админки';
  }
  if (code === 'INVALID_STATUS_FOR_START') {
    return 'Документ уже запущен или не в статусе «Входящий»';
  }
  if (code === 'DOWNLOAD_NOT_AVAILABLE') {
    return 'Расчёт ещё не готов к отправке';
  }
  if (code === 'TOPUP_NOT_FOUND') {
    return 'Заявка не найдена';
  }
  if (code === 'TOPUP_ALREADY_CONFIRMED') {
    return 'Заявка уже подтверждена — отменить нельзя';
  }
  if (code === 'TOPUP_NOT_PENDING') {
    return 'Заявка уже отменена';
  }
  return 'Не удалось выполнить действие';
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
        await this.removePressedButton(ctx, data);
      } else if (action === 'start') {
        await this.apiClient.startDocument(arg, from.id);
        await ctx.answerCallbackQuery({ text: '🚀 Расчёт запущен' });
        await this.removePressedButton(ctx, data);
      } else if (action === 'send') {
        await this.apiClient.sendDocument(arg, from.id);
        await ctx.answerCallbackQuery({ text: '📤 Расчёт отправлен клиенту' });
        await this.removePressedButton(ctx, data);
      } else if (action === 'confirm-topup') {
        await this.apiClient.confirmTopUp(arg, from.id);
        await ctx.answerCallbackQuery({ text: '✅ Пополнение подтверждено' });
        await this.clearKeyboard(ctx);
      } else if (action === 'cancel-topup') {
        await this.apiClient.cancelTopUp(arg, from.id);
        await ctx.answerCallbackQuery({ text: '🚫 Заявка отклонена' });
        await this.clearKeyboard(ctx);
      } else if (action === 'reply') {
        await this.activeDialog.set(ctx.chat!.id, { clientId: arg, clientName: '' });
        await ctx.answerCallbackQuery({ text: '✍️ Режим ответа включён' });
        await ctx.reply('Отправьте текст — он уйдёт клиенту.');
      } else {
        await ctx.answerCallbackQuery().catch(() => undefined);
      }
    } catch (err) {
      await ctx
        .answerCallbackQuery({ text: describeCallbackError(err), show_alert: true })
        .catch(() => undefined);
      this.logger.warn(`Callback "${data}" failed: ${(err as Error).message}`);
    }
  }

  /**
   * Убирает нажатую кнопку из уведомления после успешного действия: «Взять» уже
   * взятого и «Запустить» уже запущенного — источник двойных кликов и гонок
   * (повторное действие сервер отбивает, но мёртвая кнопка путает). Остальные
   * кнопки сообщения (например, «🚀 Запустить» после «Взять») остаются. У других
   * менеджеров копии уведомления не редактируются — их message_id здесь неизвестны,
   * повтор у них упирается в 409/400 с внятным toast.
   */
  private async removePressedButton(ctx: Context, pressedData: string): Promise<void> {
    const markup = ctx.callbackQuery?.message?.reply_markup;
    if (!markup) return;
    const rows = markup.inline_keyboard
      .map((row) =>
        row.filter((btn) => !('callback_data' in btn) || btn.callback_data !== pressedData),
      )
      .filter((row) => row.length > 0);
    await ctx
      .editMessageReplyMarkup(rows.length > 0 ? { reply_markup: { inline_keyboard: rows } } : undefined)
      .catch(() => undefined);
  }

  /**
   * Полностью убирает клавиатуру уведомления после разрешения заявки на пополнение
   * (подтверждена/отклонена): обе кнопки больше не актуальны, оставлять «другую» нельзя.
   */
  private async clearKeyboard(ctx: Context): Promise<void> {
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  }
}
