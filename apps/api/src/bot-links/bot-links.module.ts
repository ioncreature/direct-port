import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../database/entities/company.entity';
import { BotLinksController } from './bot-links.controller';
import { BotLinksService } from './bot-links.service';

/** REDIS_CLIENT поставляется глобальным RedisModule — отдельный импорт не нужен. */
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [BotLinksController],
  providers: [BotLinksService],
})
export class BotLinksModule {}
