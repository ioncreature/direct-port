import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Минимальное состояние диалога клиента: внутренний telegramUserId (чтобы не
 * регистрировать при каждом сообщении) + язык. Выбора колонок/уточнений нет —
 * вся обработка ушла менеджеру.
 */
export interface ConversationState {
  telegramUserId: string;
  language: string;
}

const STATE_TTL = 24 * 3600; // 24 часа

@Injectable()
export class ConversationStateService implements OnModuleDestroy {
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6380');
  }

  private key(chatId: number): string {
    return `client-conv:${chatId}`;
  }

  async getState(chatId: number): Promise<ConversationState | null> {
    const data = await this.redis.get(this.key(chatId));
    if (!data) return null;
    return JSON.parse(data);
  }

  async setState(chatId: number, state: ConversationState): Promise<void> {
    await this.redis.set(this.key(chatId), JSON.stringify(state), 'EX', STATE_TTL);
  }

  async clearState(chatId: number): Promise<void> {
    await this.redis.del(this.key(chatId));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
