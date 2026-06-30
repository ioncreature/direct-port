import { Injectable, Logger } from '@nestjs/common';
import { Api, Bot } from 'grammy';
import type { BotContext } from './i18n';

/**
 * Фиксированный id дефолтной (платформенной) компании — совпадает с DEFAULT_COMPANY_ID в apps/api
 * (создаётся миграцией AddMultiTenancy). Её бот поднимается из env TELEGRAM_BOT_TOKEN.
 */
export const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

export interface RegisteredBot {
  companyId: string;
  bot: Bot<BotContext>;
}

/**
 * Реестр клиентских ботов: один Bot на компанию (плюс дефолтный из env). BotService наполняет
 * реестр и управляет жизненным циклом ботов; OutgoingHandler берёт отсюда Api для доставки
 * исходящего по companyId из job. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotRegistry {
  private logger = new Logger(BotRegistry.name);
  private bots = new Map<string, RegisteredBot>();

  register(entry: RegisteredBot): void {
    this.bots.set(entry.companyId, entry);
  }

  all(): RegisteredBot[] {
    return [...this.bots.values()];
  }

  /**
   * Api для доставки исходящего по companyId. Если бот компании не заведён (или companyId не
   * передан) — падаём на дефолтный (env) бот: переходный период, пока у компаний нет своих ботов
   * и все клиенты в дефолтной компании. null — нет даже дефолтного бота (токен не настроен).
   */
  getApi(companyId: string | undefined): Api | null {
    if (companyId) {
      const entry = this.bots.get(companyId);
      if (entry) return entry.bot.api;
      this.logger.warn(`No bot for company ${companyId}, falling back to default bot`);
    }
    return this.bots.get(DEFAULT_COMPANY_ID)?.bot.api ?? null;
  }
}
