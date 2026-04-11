import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { FindTelegramUsersQueryDto } from './dto/find-telegram-users-query.dto';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

@Injectable()
export class TelegramUsersService {
  constructor(@InjectRepository(TelegramUser) private repo: Repository<TelegramUser>) {}

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

  async findAll(
    query: FindTelegramUsersQueryDto,
  ): Promise<PaginatedResponse<TelegramUser & { documentCount: number }>> {
    const [data, total] = (await this.repo
      .createQueryBuilder('tu')
      .loadRelationCountAndMap('tu.documentCount', 'tu.documents')
      .orderBy(`tu.${query.sortBy}`, query.sortOrder)
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount()) as [Array<TelegramUser & { documentCount: number }>, number];

    return paginate(data, total, query.page, query.limit);
  }

  async findOneById(id: string): Promise<TelegramUser & { documentCount: number }> {
    const [user] = (await this.repo
      .createQueryBuilder('tu')
      .loadRelationCountAndMap('tu.documentCount', 'tu.documents')
      .where('tu.id = :id', { id })
      .getMany()) as Array<TelegramUser & { documentCount: number }>;
    if (!user) throw new NotFoundException('Telegram user not found');
    return user;
  }

  async findByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }
}
