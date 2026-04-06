import { Injectable } from '@nestjs/common';
import { Context } from 'grammy';

@Injectable()
export class StartHandler {
  async handle(ctx: Context) {
    await ctx.reply(
      'Добро пожаловать в DirectPort Bot!\n\n' +
      'Отправьте мне Excel-файл (.xlsx) с товарами, и я:\n' +
      '• Сопоставлю описания с кодами ТН ВЭД\n' +
      '• Рассчитаю таможенные пошлины и НДС\n' +
      '• Подсчитаю логистическую комиссию\n\n' +
      'Используйте /help для подробной информации.',
    );
  }
}
