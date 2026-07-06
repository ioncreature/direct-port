import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { errMsg } from '../common/errors';
import { Company } from '../database/entities/company.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { BOT_KINDS, type BotKind } from './dto/publish-bot-identity.dto';

const KEY_PREFIX = 'bot-link:';

export interface BotLink {
  username: string;
  url: string;
  /** true — компания настроила собственный бот; false — общий платформенный (env-дефолт). */
  own: boolean;
  /** Когда общий бот опубликовал identity (только для дефолтных ботов из Redis). */
  updatedAt?: string;
}

interface StoredIdentity {
  username: string;
  updatedAt: string;
}

/**
 * Ссылки на Telegram-ботов для админки. Два источника:
 *  - собственный бот компании — username из `companies.*_bot_username` (резолвится через getMe
 *    при вводе токена в модуле Bots) → `own: true`;
 *  - общий платформенный бот — client-bot/manager-bot при старте публикуют свой username через
 *    getMe в Redis (POST /bot-links/identity) → `own: false`.
 * `getLinksForCompany` отдаёт собственный бот компании, а при его отсутствии — общий дефолтный.
 * Хранилище дефолтов — Redis без TTL: username стабилен, перезаписывается при рестарте бота.
 */
@Injectable()
export class BotLinksService {
  private logger = new Logger(BotLinksService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Company) private readonly companiesRepo: Repository<Company>,
  ) {}

  async setIdentity(kind: BotKind, username: string): Promise<void> {
    const payload: StoredIdentity = {
      username,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(`${KEY_PREFIX}${kind}`, JSON.stringify(payload));
    this.logger.log(`Stored ${kind} bot identity: @${username}`);
  }

  /**
   * Боты для компании: собственный бот (own:true), если у компании задан токен, иначе общий
   * платформенный (own:false). Без companyId (super_admin без выбранной компании) — только общие.
   */
  async getLinksForCompany(companyId?: string): Promise<Record<BotKind, BotLink | null>> {
    const defaults = await this.getLinks();
    if (!companyId) return defaults;
    const company = await this.companiesRepo.findOne({
      where: { id: companyId },
      select: { id: true, clientBotUsername: true, managerBotUsername: true },
    });
    return {
      client: this.ownLink(company?.clientBotUsername) ?? defaults.client,
      manager: this.ownLink(company?.managerBotUsername) ?? defaults.manager,
    };
  }

  private ownLink(username: string | null | undefined): BotLink | null {
    return username ? { username, url: `https://t.me/${username}`, own: true } : null;
  }

  /** Общие (платформенные) боты из Redis — их публикуют дефолтные client-bot/manager-bot. */
  async getLinks(): Promise<Record<BotKind, BotLink | null>> {
    // Блок «Telegram-боты» — украшение дашборда: при недоступном Redis отдаём
    // пустые ссылки, а не роняем/вешаем весь дашборд.
    const raw = await this.redis
      .mget(...BOT_KINDS.map((kind) => `${KEY_PREFIX}${kind}`))
      .catch((err) => {
        this.logger.warn(`Failed to read bot links from Redis: ${errMsg(err)}`);
        return BOT_KINDS.map(() => null);
      });
    const result = {} as Record<BotKind, BotLink | null>;
    BOT_KINDS.forEach((kind, i) => {
      result[kind] = this.parse(raw[i]);
    });
    return result;
  }

  private parse(raw: string | null): BotLink | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (!parsed.username) return null;
      return {
        username: parsed.username,
        url: `https://t.me/${parsed.username}`,
        own: false,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }
}
