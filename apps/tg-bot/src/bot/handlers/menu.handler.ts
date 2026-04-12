import { Injectable } from '@nestjs/common';
import { type BotContext } from '../i18n';
import { HelpHandler } from './help.handler';

@Injectable()
export class MenuHandler {
  constructor(private helpHandler: HelpHandler) {}

  async handleUpload(ctx: BotContext) {
    await ctx.reply(ctx.t('upload-prompt'));
  }

  async handleHelp(ctx: BotContext) {
    return this.helpHandler.handle(ctx);
  }
}
