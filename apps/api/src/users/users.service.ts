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
import { User, UserRole } from '../database/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private usersRepo: Repository<User>) {}

  async findAll(
    query: FindUsersQueryDto,
    actor: Actor,
  ): Promise<PaginatedResponse<Omit<User, 'passwordHash'>>> {
    const scope = resolveCompanyScope(actor, query.companyId);
    const where: FindOptionsWhere<User> = {};
    if (query.role) where.role = query.role;
    if (scope !== undefined) where.companyId = scope;

    const [users, total] = await this.usersRepo.findAndCount({
      where,
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return paginate(
      users.map((u) => this.sanitize(u)),
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
    await this.usersRepo.remove(user);
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

  private sanitize(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
