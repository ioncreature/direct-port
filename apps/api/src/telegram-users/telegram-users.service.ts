import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { Actor, assertSameCompany, resolveCompanyScope } from '../common/tenant/actor-context';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { FindTelegramUsersQueryDto } from './dto/find-telegram-users-query.dto';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

@Injectable()
export class TelegramUsersService {
  constructor(@InjectRepository(TelegramUser) private repo: Repository<TelegramUser>) {}

  async register(dto: RegisterTelegramUserDto): Promise<TelegramUser> {
    const telegramId = String(dto.telegramId);
    // Язык из регистрации — это автодетект Telegram-локали, и он применяется только
    // при первом знакомстве (INSERT): повторная регистрация (повторный /start,
    // протухшее Redis-состояние client-bot) откатывала ручной выбор /language →
    // следующий документ уходил в pipeline с чужим языком. Поэтому language есть
    // в VALUES, но исключён из DO UPDATE SET. Ручная смена — updateLanguage (PATCH).
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(TelegramUser)
      .values({
        telegramId,
        username: dto.username ?? null,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        ...(dto.language ? { language: dto.language } : {}),
      })
      .orUpdate(['username', 'first_name', 'last_name'], ['telegram_id'])
      .execute();

    return this.repo.findOneByOrFail({ telegramId });
  }

  async updateLanguage(telegramId: string, language: string): Promise<void> {
    await this.repo.update({ telegramId }, { language });
  }

  async findAll(
    query: FindTelegramUsersQueryDto,
    actor: Actor,
  ): Promise<PaginatedResponse<TelegramUser & { documentCount: number }>> {
    const scope = resolveCompanyScope(actor, query.companyId);
    const qb = this.repo
      .createQueryBuilder('tu')
      .loadRelationCountAndMap('tu.documentCount', 'tu.documents')
      .orderBy(`tu.${query.sortBy}`, query.sortOrder)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    // NULL-клиенты (общий пул, ещё не взяты менеджером) видны только super_admin.
    if (scope !== undefined) qb.where('tu.company_id = :scope', { scope });

    const [data, total] = (await qb.getManyAndCount()) as [
      Array<TelegramUser & { documentCount: number }>,
      number,
    ];

    return paginate(data, total, query.page, query.limit);
  }

  async findOneById(id: string, actor: Actor): Promise<TelegramUser & { documentCount: number }> {
    const [user] = (await this.repo
      .createQueryBuilder('tu')
      .loadRelationCountAndMap('tu.documentCount', 'tu.documents')
      .where('tu.id = :id', { id })
      .getMany()) as Array<TelegramUser & { documentCount: number }>;
    if (!user) throw new NotFoundException('Telegram user not found');
    assertSameCompany(actor, user.companyId);
    return user;
  }

  /** Лёгкая проверка доступа к клиенту (для истории переписки): 404 на чужого/несуществующего. */
  async assertAccess(id: string, actor: Actor): Promise<void> {
    const user = await this.repo.findOne({ where: { id }, select: ['id', 'companyId'] });
    if (!user) throw new NotFoundException('Telegram user not found');
    assertSameCompany(actor, user.companyId);
  }

  async findByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }
}
