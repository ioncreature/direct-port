import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Company } from '../database/entities/company.entity';
import { User } from '../database/entities/user.entity';
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
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Company) private readonly companiesRepo: Repository<Company>,
  ) {}

  async createToken(userId: string): Promise<{ token: string; deepLink: string }> {
    const token = randomBytes(24).toString('hex'); // 48 hex — влезает в Telegram start-параметр
    await this.redis.set(`${KEY_PREFIX}${token}`, userId, 'EX', TOKEN_TTL_SECONDS);
    const botUsername = await this.resolveManagerBotUsername(userId);
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${token}` : `?start=${token}`;
    return { token, deepLink };
  }

  /**
   * Username менеджерского бота для deep-link: бот компании менеджера (per-company), иначе
   * дефолтный из env MANAGER_BOT_USERNAME. См. docs/COMPANY_BOTS.md.
   */
  private async resolveManagerBotUsername(userId: string): Promise<string> {
    const user = await this.usersRepo.findOne({ where: { id: userId }, select: ['companyId'] });
    if (user?.companyId) {
      const company = await this.companiesRepo.findOne({
        where: { id: user.companyId },
        select: ['managerBotUsername'],
      });
      if (company?.managerBotUsername) return company.managerBotUsername;
    }
    return this.config.get<string>('MANAGER_BOT_USERNAME', '');
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
