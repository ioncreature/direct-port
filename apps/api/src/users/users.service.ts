import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { Actor, assertSameCompany, resolveCompanyScope } from '../common/tenant/actor-context';
import { ConversationMessage } from '../database/entities/conversation-message.entity';
import { DepositTransaction } from '../database/entities/deposit-transaction.entity';
import { Document } from '../database/entities/document.entity';
import { TopUpRequest } from '../database/entities/top-up-request.entity';
import { User, UserRole } from '../database/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Пользователь без секрета и без relation-объекта company (наружу отдаём только companyId-скаляр). */
type SanitizedUser = Omit<User, 'passwordHash' | 'company'>;
/** Элемент списка пользователей: + название компании для отображения в админке. */
type UserListItem = SanitizedUser & { companyName: string | null };

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private usersRepo: Repository<User>) {}

  async findAll(
    query: FindUsersQueryDto,
    actor: Actor,
  ): Promise<PaginatedResponse<UserListItem>> {
    const scope = resolveCompanyScope(actor, query.companyId);
    const where: FindOptionsWhere<User> = {};
    if (query.role) where.role = query.role;
    if (scope !== undefined) where.companyId = scope;

    const [users, total] = await this.usersRepo.findAndCount({
      where,
      relations: { company: true },
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return paginate(
      users.map((u) => ({ ...this.sanitize(u), companyName: u.company?.name ?? null })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string, actor: Actor) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    assertSameCompany(actor, user.companyId);
    return this.sanitize(user);
  }

  async create(dto: CreateUserDto, actor: Actor) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const { role, companyId } = this.resolveCreateTarget(dto, actor);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({ email: dto.email, passwordHash, role, companyId });
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    assertSameCompany(actor, user.companyId);

    if (dto.email !== undefined) user.email = dto.email;
    if (dto.role !== undefined && dto.role !== user.role) {
      this.applyRoleChange(user, dto.role, actor);
    }
    // Смену компании обрабатываем после роли: роль определяет, допустима ли компания вообще.
    if (dto.companyId !== undefined) {
      this.applyCompanyChange(user, dto.companyId, actor);
    }
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async remove(id: string, actor: Actor) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    assertSameCompany(actor, user.companyId);
    // Себя удалить нельзя (в UI кнопка скрыта; здесь — защита на бэке).
    if (id === actor.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    // Нельзя удалять пользователя, за которым числятся артефакты: FK всех этих ссылок = SET NULL,
    // т.е. удаление молча осиротило бы документы, переписку и аудит операций с балансом.
    await this.assertDeletable(id);
    await this.usersRepo.remove(user);
  }

  /**
   * Блокирует удаление пользователя, за которым остались артефакты: загруженные им документы,
   * отправленные как менеджер сообщения, выполненные операции с балансом и подтверждённые
   * пополнения. Считаем через общий EntityManager, не раздувая конструктор сервиса репозиториями.
   */
  private async assertDeletable(userId: string): Promise<void> {
    const em = this.usersRepo.manager;
    // exists, а не count: нужен лишь факт наличия — короткое замыкание на первой строке
    // (эти FK-колонки не проиндексированы, полный COUNT был бы дороже).
    const [documents, messages, deposits, topUps] = await Promise.all([
      em.exists(Document, { where: { uploadedByUserId: userId } }),
      em.exists(ConversationMessage, { where: { managerId: userId } }),
      em.exists(DepositTransaction, { where: { createdByUserId: userId } }),
      em.exists(TopUpRequest, { where: { confirmedByUserId: userId } }),
    ]);
    if (documents || messages || deposits || topUps) {
      throw new ConflictException(
        'Cannot delete a user who has uploaded documents or other related records',
      );
    }
  }

  /**
   * Определяет роль и компанию создаваемого пользователя с учётом актора.
   * super_admin: создаёт кого угодно (super_admin → company NULL; admin/customs → требуется
   * companyId). admin компании: только admin/customs в СВОЕЙ компании (companyId из DTO
   * игнорируется), super_admin создавать нельзя.
   */
  private resolveCreateTarget(
    dto: CreateUserDto,
    actor: Actor,
  ): { role: UserRole; companyId: string | null } {
    if (actor.role === UserRole.SUPER_ADMIN) {
      if (dto.role === UserRole.SUPER_ADMIN) {
        return { role: UserRole.SUPER_ADMIN, companyId: null };
      }
      if (!dto.companyId) {
        throw new BadRequestException('companyId is required for admin/customs users');
      }
      return { role: dto.role, companyId: dto.companyId };
    }

    if (dto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot create a super admin');
    }
    if (!actor.companyId) {
      throw new ForbiddenException('User is not assigned to a company');
    }
    return { role: dto.role, companyId: actor.companyId };
  }

  /** Меняет роль с соблюдением инварианта role↔company (CHK_users_company_role). */
  private applyRoleChange(user: User, newRole: UserRole, actor: Actor): void {
    if (newRole === UserRole.SUPER_ADMIN) {
      if (actor.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Cannot promote user to super admin');
      }
      user.role = UserRole.SUPER_ADMIN;
      user.companyId = null; // super_admin не имеет компании
      return;
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      // понижение super_admin требует назначить компанию — не делаем через update
      throw new BadRequestException('Cannot change a super admin role here; recreate the user');
    }
    user.role = newRole; // admin ↔ customs внутри компании, company не меняется
  }

  /**
   * Переносит admin/customs в другую компанию. Только глобальный super_admin: admin компании
   * не может перемещать людей между тенантами. У super_admin компании нет (инвариант
   * CHK_users_company_role) — задать её нельзя. Существование компании не проверяем: FK
   * users.company_id отобьёт несуществующий id (как и при create).
   */
  private applyCompanyChange(user: User, companyId: string, actor: Actor): void {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only super admin can change a user company');
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Super admin cannot belong to a company');
    }
    user.companyId = companyId;
  }

  private sanitize(user: User): SanitizedUser {
    const { passwordHash, company, ...rest } = user;
    return rest;
  }
}
