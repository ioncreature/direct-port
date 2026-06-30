import { Injectable } from '@nestjs/common';
import { ApiClientService } from '../api-client/api-client.service';
import { type BotContext, mapTelegramLocale } from './i18n';
import { ConversationStateService } from './state/conversation-state.service';

/**
 * Возвращает внутренний telegramUserId (UUID) клиента: из Redis-кэша или
 * регистрирует через API (идемпотентно). Общий для file-upload и message хендлеров.
 */
@Injectable()
export class ClientResolverService {
  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async resolveTelegramUserId(ctx: BotContext): Promise<string> {
    const { companyId } = ctx;
    const chatId = ctx.chat!.id;
    const existing = (await this.stateService.getState(companyId, chatId))?.telegramUserId;
    if (existing) return existing;

    const from = ctx.from!;
    const language = mapTelegramLocale(from.language_code);
    const tgUser = await this.apiClient.registerTelegramUser({
      telegramId: from.id,
      companyId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      language,
    });
    await this.stateService.setState(companyId, chatId, { telegramUserId: tgUser.id, language });
    return tgUser.id;
  }
}
