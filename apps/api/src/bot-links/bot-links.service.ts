import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { errMsg } from '../common/errors';
import { REDIS_CLIENT } from '../redis/redis.module';
import { BOT_KINDS, type BotKind } from './dto/publish-bot-identity.dto';

const KEY_PREFIX = 'bot-link:';

export interface BotLink {
  username: string;
  url: string;
  updatedAt: string;
}

interface StoredIdentity {
  username: string;
  updatedAt: string;
}

/**
 * Ссылки на Telegram-ботов для админки. client-bot/manager-bot при старте
 * резолвят свой username через getMe и публикуют его сюда (POST /bot-links/identity).
 * Хранилище — Redis (без TTL): username бота стабилен, перезаписывается при каждом
 * старте бота. При сбросе Redis ссылки восстановятся после ближайшего рестарта ботов.
 */
@Injectable()
export class BotLinksService {
  private logger = new Logger(BotLinksService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async setIdentity(kind: BotKind, username: string): Promise<void> {
    const payload: StoredIdentity = {
      username,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(`${KEY_PREFIX}${kind}`, JSON.stringify(payload));
    this.logger.log(`Stored ${kind} bot identity: @${username}`);
  }

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
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }
}
