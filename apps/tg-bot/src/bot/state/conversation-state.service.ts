import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface ColumnMapping {
  description?: number;
  price?: number;
  weight?: number;
  quantity?: number;
}

export interface ConversationState {
  step:
    | 'idle'
    | 'awaiting_column_description'
    | 'awaiting_column_price'
    | 'awaiting_column_weight'
    | 'awaiting_column_quantity';
  fileBuffer: string;
  fileName: string;
  fileType: 'xlsx' | 'csv';
  headers: string[];
  columnMapping: ColumnMapping;
  telegramUserId: string;
}

const STATE_TTL = 3600; // 1 hour

@Injectable()
export class ConversationStateService implements OnModuleDestroy {
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(
      this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6380',
    );
  }

  private key(chatId: number): string {
    return `conv:${chatId}`;
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
