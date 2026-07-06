import { Injectable, Logger } from '@nestjs/common';
import { Api, Bot } from 'grammy';

/**
 * Канал Redis pub/sub, на который api публикует изменения токенов ботов компаний (имя совпадает
 * с BOT_CONFIG_CHANNEL в apps/api). Бот подписан на него для динамического reload. См. docs/COMPANY_BOTS.md.
 */
export const BOT_CONFIG_CHANNEL = 'bot-config-events';

export interface BotConfigEvent {
  companyId: string;
  kind: 'client' | 'manager';
  action: 'upsert' | 'remove';
}

export interface RegisteredBot {
  companyId: string;
  bot: Bot;
  /** Токен, на котором поднят бот — чтобы reconcile увидел смену токена и пересоздал бот. */
  token: string;
}

/**
 * Реестр менеджерских ботов: один Bot на компанию. BotService наполняет реестр и управляет
 * жизненным циклом; NotifyHandler берёт отсюда Api для доставки уведомления через manager-bot
 * нужной компании (по companyId из job). См. docs/COMPANY_BOTS.md.
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

  get(companyId: string): RegisteredBot | undefined {
    return this.bots.get(companyId);
  }

  /** Убирает бот из реестра и возвращает запись (вызывающий останавливает bot). */
  remove(companyId: string): RegisteredBot | undefined {
    const entry = this.bots.get(companyId);
    this.bots.delete(companyId);
    return entry;
  }

  /**
   * Api бота компании по companyId для доставки уведомления. null — у компании нет заведённого
   * бота (companyId не передан или токен не настроен): доставка уходит в failed-job, а не молча
   * теряется. Fallback на дефолтный env-бот убран вместе с env-подходом (боты — только per-company).
   */
  getApi(companyId: string | undefined): Api | null {
    if (!companyId) return null;
    const entry = this.bots.get(companyId);
    if (entry) return entry.bot.api;
    this.logger.warn(`No bot for company ${companyId}`);
    return null;
  }
}
