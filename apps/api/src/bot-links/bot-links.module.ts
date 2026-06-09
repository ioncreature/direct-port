import { Module } from '@nestjs/common';
import { BotLinksController } from './bot-links.controller';
import { BotLinksService } from './bot-links.service';

/** REDIS_CLIENT поставляется глобальным RedisModule — отдельный импорт не нужен. */
@Module({
  controllers: [BotLinksController],
  providers: [BotLinksService],
})
export class BotLinksModule {}
