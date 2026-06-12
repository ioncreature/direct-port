import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const TOKEN_TTL_SECONDS = 15 * 60;
const KEY_PREFIX = 'mgr-link:';

/**
 * Одноразовые токены привязки менеджерского Telegram-аккаунта к User.
 * Админка генерит токен (createToken) → менеджер открывает deep-link в manager-bot →
 * бот шлёт токен в POST /manager/link → consumeToken резолвит userId.
 * Хранилище — Redis (TTL 15 мин), переживает рестарт и работает на нескольких репликах.
 */
@Injectable()
export class ManagerLinkService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async createToken(userId: string): Promise<{ token: string; deepLink: string }> {
    const token = randomBytes(24).toString('hex'); // 48 hex — влезает в Telegram start-параметр
    await this.redis.set(`${KEY_PREFIX}${token}`, userId, 'EX', TOKEN_TTL_SECONDS);
    const botUsername = this.config.get<string>('MANAGER_BOT_USERNAME', '');
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : `?start=${token}`;
    return { token, deepLink };
  }

  /**
   * Резолвит токен в userId одноразово. null — истёк/неверен. GETDEL атомарен:
   * раздельные GET+DEL позволяли двум конкурентным /start с одним токеном (ссылку
   * переслали) обоим получить «✅ Привязано», хотя привязывался только последний.
   */
  async consumeToken(token: string): Promise<string | null> {
    return this.redis.getdel(`${KEY_PREFIX}${token}`);
  }
}
