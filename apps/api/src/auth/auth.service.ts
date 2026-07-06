import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { CompaniesService } from '../companies/companies.service';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { User, UserRole } from '../database/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(RefreshToken) private refreshRepo: Repository<RefreshToken>,
    private jwtService: JwtService,
    private config: ConfigService,
    private companiesService: CompaniesService,
  ) {}

  /**
   * @param domain — хост, с которого выполняется вход (заголовок x-tenant-host от admin-web-прокси).
   *   Используется тенант-гейтом: пользователь не-super_admin должен принадлежать компании этого
   *   домена. Неизвестный/пустой домен резолвится в дефолтную компанию (вход по bare-домену/localhost).
   */
  async login(email: string, password: string, domain?: string) {
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Заблокированному аккаунту сообщаем об отключении ЯВНО (403), но только после проверки
    // пароля — чтобы посторонний по коду ответа не узнал, что такой email существует и отключён.
    if (!user.isActive) {
      throw new ForbiddenException('Ваш аккаунт отключён. Обратитесь к администратору.');
    }

    // Тенант-гейт: если запрос несёт домен (admin-web всегда проставляет x-tenant-host), пользователь
    // не-super_admin должен принадлежать компании этого домена. super_admin входит с любого домена
    // (глобальная роль, company_id = NULL). Без домена (прямой вызов API/тесты) гейтить не против чего —
    // изоляция данных всё равно держится на company-scope каждого запроса. Сообщение намеренно
    // неотличимо от неверного пароля (не раскрываем принадлежность email тенанту).
    const host = domain?.trim();
    if (host && user.role !== UserRole.SUPER_ADMIN) {
      const expectedCompanyId = await this.companiesService.resolveCompanyIdByDomain(host);
      if (user.companyId !== expectedCompanyId) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string) {
    const found = await this.refreshRepo.findOne({
      where: { tokenHash: this.hashToken(refreshToken), expiresAt: MoreThan(new Date()) },
      relations: ['user'],
    });

    if (!found || !found.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.refreshRepo.delete(found.id);
    return this.generateTokens(found.user);
  }

  async logout(refreshToken: string) {
    await this.refreshRepo.delete({ tokenHash: this.hashToken(refreshToken) });
  }

  /**
   * Refresh-токен — высокоэнтропийный `randomUUID()` (122 бита), поэтому храним детерминированный
   * sha256-хеш в индексированной колонке token_hash: поиск токена — прямой хит по индексу
   * (findOne / delete по token_hash), без перебора таблицы с bcrypt.compare на каждой строке.
   * bcrypt здесь не нужен — он защищает низкоэнтропийные пароли от брута по украденной БД,
   * а случайный UUID подобрать невозможно и без соли.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateTokens(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get('JWT_ACCESS_EXPIRATION', '15m'),
    });

    const rawRefresh = randomUUID();
    const tokenHash = this.hashToken(rawRefresh);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.refreshRepo.save({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      },
    };
  }
}
