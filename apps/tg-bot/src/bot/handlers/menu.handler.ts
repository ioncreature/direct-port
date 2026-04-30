import { Injectable } from '@nestjs/common';
import { Keyboard } from 'grammy';
import { type BotContext } from '../i18n';
import { HelpHandler } from './help.handler';

@Injectable()
export class MenuHandler {
  constructor(private helpHandler: HelpHandler) {}

  async handleHelp(ctx: BotContext) {
    return this.helpHandler.handle(ctx);
  }

  /**
   * Старая reply-кнопка «Загрузить файл» удалена в коммите 3ee4eb6, но Telegram
   * хранит reply-клавиатуру на клиенте, и у пользователей, нажавших /start до
   * деплоя, она остаётся видимой. При нажатии шлём новую клавиатуру (только
   * «Помощь») — она перезаписывает legacy-версию у клиента, плюс подсказку, что
   * файл нужно прикреплять через скрепку.
   */
  async handleLegacyUpload(ctx: BotContext) {
    const keyboard = new Keyboard().text(ctx.t('btn-help')).resized();
    await ctx.reply(ctx.t('upload-via-attachment'), { reply_markup: keyboard });
  }
}
