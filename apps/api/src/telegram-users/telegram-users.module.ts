import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { TelegramUsersController } from './telegram-users.controller';
import { TelegramUsersService } from './telegram-users.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser])],
  controllers: [TelegramUsersController],
  providers: [TelegramUsersService],
  exports: [TelegramUsersService],
})
export class TelegramUsersModule {}
