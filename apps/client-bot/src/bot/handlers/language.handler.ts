import { Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { type BotContext, type SupportedLocale, SUPPORTED_LOCALES } from '../i18n';
import { ConversationStateService } from '../state/conversation-state.service';

const LANGUAGE_LABELS: Record<string, string> = {
  ru: '🇷🇺 Русский',
  zh: '🇨🇳 中文',
  en: '🇬🇧 English',
};

@Injectable()
export class LanguageHandler {
  private logger = new Logger(LanguageHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handleCommand(ctx: BotContext) {
    const kb = new InlineKeyboard();
    for (const locale of SUPPORTED_LOCALES) {
      kb.text(LANGUAGE_LABELS[locale], `lang_${locale}`).row();
    }
    await ctx.reply(ctx.t('language-prompt'), { reply_markup: kb });
  }

  async handleCallback(ctx: BotContext) {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('lang_')) return;

    const locale = data.slice(5) as SupportedLocale;
    if (!SUPPORTED_LOCALES.includes(locale)) return;

    await ctx.answerCallbackQuery();
    ctx.i18n.useLocale(locale);

    const chatId = ctx.chat?.id;
    if (chatId) {
      const state = await this.stateService.getState(ctx.companyId, chatId);
      if (state) {
        state.language = locale;
        await this.stateService.setState(ctx.companyId, chatId, state);
      }
    }

    const telegramId = ctx.from?.id;
    if (telegramId) {
      // Язык обновляется точечно по паре (companyId, telegramId) — у клиента нескольких компаний
      // не затрагивает его записи в других компаниях. companyId берём из контекста бота.
      this.apiClient.updateUserLanguage(ctx.companyId, telegramId, locale).catch((err) => {
        this.logger.error(
          `Failed to update language for telegramId=${telegramId}: ${(err as Error).message}`,
        );
      });
    }

    await ctx.editMessageText(ctx.t('language-set'));
  }
}
