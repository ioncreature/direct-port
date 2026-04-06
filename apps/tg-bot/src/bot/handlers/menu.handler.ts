import { Injectable } from '@nestjs/common';
import { Context } from 'grammy';
import { HelpHandler } from './help.handler';

@Injectable()
export class MenuHandler {
  constructor(private helpHandler: HelpHandler) {}

  async handleUpload(ctx: Context) {
    await ctx.reply('Отправьте мне файл в формате .xlsx или .csv');
  }

  async handleHelp(ctx: Context) {
    return this.helpHandler.handle(ctx);
  }
}
