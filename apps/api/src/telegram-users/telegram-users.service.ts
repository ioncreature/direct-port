import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

@Injectable()
export class TelegramUsersService {
  constructor(
    @InjectRepository(TelegramUser) private repo: Repository<TelegramUser>,
  ) {}

  async register(dto: RegisterTelegramUserDto): Promise<TelegramUser> {
    let user = await this.repo.findOne({
      where: { telegramId: String(dto.telegramId) },
    });

    if (user) {
      if (dto.username !== undefined) user.username = dto.username;
      if (dto.firstName !== undefined) user.firstName = dto.firstName;
      if (dto.lastName !== undefined) user.lastName = dto.lastName;
    } else {
      user = this.repo.create({
        telegramId: String(dto.telegramId),
        username: dto.username ?? null,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
      });
    }

    return this.repo.save(user);
  }

  async findByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }
}
