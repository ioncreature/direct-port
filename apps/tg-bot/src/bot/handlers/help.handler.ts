import { Injectable } from '@nestjs/common';
import { Context } from 'grammy';

@Injectable()
export class HelpHandler {
  async handle(ctx: Context) {
    await ctx.reply(
      '📋 Формат Excel-файла:\n\n' +
        'Столбцы (заголовок в первой строке):\n' +
        '1. Описание/Наименование товара\n' +
        '2. Количество\n' +
        '3. Цена (за единицу, USD)\n' +
        '4. Вес (кг)\n\n' +
        'Поддерживаемые форматы: .xlsx\n\n' +
        'Команды:\n' +
        '/start — приветствие\n' +
        '/help — эта справка',
    );
  }
}
