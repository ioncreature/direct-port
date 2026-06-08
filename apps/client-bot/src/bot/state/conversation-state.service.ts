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
  /** Клиент уже получил подтверждение первого контакта в этой сессии. */
  greeted?: boolean;
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

  /**
   * Помечает, что клиента уже поприветствовали в этой сессии.
   * Возвращает true только при первом вызове — чтобы не слать подтверждение
   * на каждое сообщение, а лишь на первый контакт.
   */
  async markGreetedIfFirst(chatId: number): Promise<boolean> {
    const state = await this.getState(chatId);
    if (!state || state.greeted) return false;
    await this.setState(chatId, { ...state, greeted: true });
    return true;
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
