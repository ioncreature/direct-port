import { Injectable } from '@nestjs/common';
import { type BotContext } from '../i18n';

@Injectable()
export class HelpHandler {
  async handle(ctx: BotContext) {
    await ctx.reply(ctx.t('help'));
  }
}
