import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { Actor, assertSameCompany, resolveCompanyScope } from '../common/tenant/actor-context';
import { BillingAccount } from '../database/entities/billing-account.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { FindTelegramUsersQueryDto } from './dto/find-telegram-users-query.dto';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

/** Postgres unique_violation (23505) — TypeORM прячет код в driverError. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

@Injectable()
export class TelegramUsersService {
  constructor(@InjectRepository(TelegramUser) private repo: Repository<TelegramUser>) {}

  async register(dto: RegisterTelegramUserDto): Promise<TelegramUser> {
    const telegramId = String(dto.telegramId);
    const mutable = {
      username: dto.username ?? null,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
    };

    // Повторная регистрация (повторный /start, протухшее Redis-состояние client-bot) —
    // обновляем только изменяемые поля. Язык НЕ трогаем: при первом знакомстве он ставится
    // автодетектом локали, дальше им владеет ручной /language (updateLanguage), иначе
    // повторный /start откатывал бы выбор и следующий документ ушёл бы с чужим языком.
    const existing = await this.repo.findOne({ where: { telegramId } });
    if (existing) {
      await this.repo.update({ telegramId }, mutable);
      return this.repo.findOneByOrFail({ telegramId });
    }

    // Новый клиент заводится вместе с биллинг-аккаунтом (1:1) в одной транзакции, чтобы у
    // каждого клиента всегда был владелец баланса. Гонка одновременных первых /start от
    // одного клиента: один INSERT побеждает, второй падает на unique(telegram_id), и аккаунт
    // его откатившейся транзакции не остаётся — добираем уже существующего клиента.
    try {
      await this.repo.manager.transaction(async (em) => {
        const account = await em.save(em.create(BillingAccount, { balance: 0 }));
        await em.insert(TelegramUser, {
          telegramId,
          ...mutable,
          billingAccountId: account.id,
          ...(dto.language ? { language: dto.language } : {}),
        });
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await this.repo.update({ telegramId }, mutable);
    }
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

  /**
   * Поиск клиентов для привязки к лиду (автокомплит): по username/имени/telegram_id,
   * скоуп по компании актора, до 10 совпадений. Отдаёт только поля для отображения.
   */
  async search(q: string, actor: Actor): Promise<TelegramUser[]> {
    const scope = resolveCompanyScope(actor);
    const qb = this.repo
      .createQueryBuilder('tu')
      .select(['tu.id', 'tu.telegramId', 'tu.username', 'tu.firstName', 'tu.lastName'])
      .orderBy('tu.createdAt', 'DESC')
      .take(10);
    if (scope !== undefined) qb.where('tu.company_id = :scope', { scope });
    const term = q.trim();
    if (term) {
      qb.andWhere(
        '(tu.username ILIKE :s OR tu.first_name ILIKE :s OR tu.last_name ILIKE :s OR CAST(tu.telegram_id AS TEXT) ILIKE :s)',
        { s: `%${term}%` },
      );
    }
    return qb.getMany();
  }

  async findOneById(
    id: string,
    actor: Actor,
  ): Promise<TelegramUser & { documentCount: number; balance: number }> {
    const [user] = (await this.repo
      .createQueryBuilder('tu')
      .leftJoinAndSelect('tu.billingAccount', 'ba')
      .loadRelationCountAndMap('tu.documentCount', 'tu.documents')
      .where('tu.id = :id', { id })
      .getMany()) as Array<TelegramUser & { documentCount: number }>;
    if (!user) throw new NotFoundException('Telegram user not found');
    assertSameCompany(actor, user.companyId);
    // Баланс переехал на BillingAccount — отдаём его плоско, как ждёт админка.
    return Object.assign(user, { balance: user.billingAccount?.balance ?? 0 });
  }

  /** Проверка доступа к клиенту + резолв его биллинг-аккаунта (404 на чужого/несуществующего). */
  async assertAccess(id: string, actor: Actor): Promise<string> {
    const user = await this.repo.findOne({
      where: { id },
      select: ['id', 'companyId', 'billingAccountId'],
    });
    if (!user) throw new NotFoundException('Telegram user not found');
    assertSameCompany(actor, user.companyId);
    return user.billingAccountId;
  }

  async findByTelegramId(telegramId: number): Promise<TelegramUser | null> {
    return this.repo.findOne({ where: { telegramId: String(telegramId) } });
  }

  /**
   * Единый гейт client-scoped writer'ов кабинета (загрузка документа, заявка на пополнение):
   * проверяет, что клиент принадлежит биллинг-аккаунту, и возвращает его. telegramUserId
   * приходит из проверенного client-JWT, но api всё равно сверяет принадлежность — BFF не
   * привилегирован. Чужой/несуществующий → 403, без утечки факта существования.
   */
  async resolveAccountMember(telegramUserId: string, accountId: string): Promise<TelegramUser> {
    const user = await this.repo.findOne({ where: { id: telegramUserId } });
    if (!user || user.billingAccountId !== accountId) {
      throw new ForbiddenException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'Telegram user does not belong to this account',
      });
    }
    return user;
  }
}
