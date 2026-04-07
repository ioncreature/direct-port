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
    const result = await this.repo.upsert(
      {
        telegramId: String(dto.telegramId),
        username: dto.username ?? null,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
      },
      { conflictPaths: ['telegramId'] },
    );

    return this.repo.findOneByOrFail({ id: result.identifiers[0].id });
  }

  async findByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }
}
