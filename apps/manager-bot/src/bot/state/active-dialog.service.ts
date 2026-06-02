import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Активный диалог менеджера: кому из клиентов он сейчас отвечает. */
export interface ActiveDialog {
  clientId: string;
  clientName: string;
}

const TTL = 3600; // 1 час

@Injectable()
export class ActiveDialogService implements OnModuleDestroy {
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6380');
  }

  private key(chatId: number): string {
    return `mgr:active:${chatId}`;
  }

  async get(chatId: number): Promise<ActiveDialog | null> {
    const data = await this.redis.get(this.key(chatId));
    return data ? JSON.parse(data) : null;
  }

  async set(chatId: number, dialog: ActiveDialog): Promise<void> {
    await this.redis.set(this.key(chatId), JSON.stringify(dialog), 'EX', TTL);
  }

  async clear(chatId: number): Promise<void> {
    await this.redis.del(this.key(chatId));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
