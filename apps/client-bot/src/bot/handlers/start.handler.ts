import { Injectable, Logger } from '@nestjs/common';
import { Keyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { type BotContext, mapTelegramLocale } from '../i18n';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class StartHandler {
  private logger = new Logger(StartHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: BotContext) {
    const from = ctx.from;
    if (!from) {
      this.logger.warn('/start received without "from" field');
      return;
    }

    const language = mapTelegramLocale(from.language_code);
    ctx.i18n.useLocale(language);

    try {
      const tgUser = await this.apiClient.registerTelegramUser({
        telegramId: from.id,
        companyId: ctx.companyId,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        language,
      });
      await this.stateService.setState(ctx.companyId, ctx.chat!.id, {
        telegramUserId: tgUser.id,
        language,
      });
      this.logger.log(`Registered client: internalId=${tgUser.id} telegramId=${from.id}`);
      // Fire-and-forget: не задерживаем приветствие на сетевой запрос атрибуции.
      void this.attributeLead(ctx, tgUser.id);
    } catch (err) {
      this.logger.error(`Failed to register client id=${from.id}: ${(err as Error).message}`);
    }

    const keyboard = new Keyboard().text(ctx.t('btn-help')).resized();
    await ctx.reply(ctx.t('welcome'), { reply_markup: keyboard });
  }

  /**
   * Атрибуция лида по deep-link `?start=lead_<id>` (из холодного письма). Best-effort:
   * любая ошибка только логируется и не ломает /start. Привязка идемпотентна на стороне API.
   */
  private async attributeLead(ctx: BotContext, telegramUserId: string): Promise<void> {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (!payload.startsWith('lead_')) return;
    const leadId = payload.slice('lead_'.length);
    if (!leadId) return;
    try {
      const res = await this.apiClient.attachLeadClient(leadId, telegramUserId);
      this.logger.log(
        `Lead attribution lead=${leadId} client=${telegramUserId}: ${res.linked ? 'linked' : res.reason}`,
      );
    } catch (err) {
      this.logger.warn(`Lead attribution failed lead=${leadId}: ${(err as Error).message}`);
    }
  }
}
