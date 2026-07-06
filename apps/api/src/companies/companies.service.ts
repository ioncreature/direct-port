import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
import {
  CompanyTheme,
  DEFAULT_COMPANY_THEME,
  normalizeCompanyTheme,
} from '../common/tenant/company-theme';
import { CompanyDomain } from '../database/entities/company-domain.entity';
import { Company } from '../database/entities/company.entity';
import { Document } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { FindCompaniesQueryDto } from './dto/find-companies-query.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Slug'и, совпадающие со статическими маршрутами кабинета (client-web) — занимать нельзя. */
const RESERVED_SLUGS = ['dashboard', 'api', '_next'];

/** Ответ API: компания с доменами в виде плоского списка строк и валидной темой. */
export interface CompanyView {
  id: string;
  name: string;
  slug: string | null;
  theme: CompanyTheme;
  /** sha256 логотипа: признак наличия и cache-busting превью на странице компании; null — нет логотипа. */
  logoHash: string | null;
  /** sha256 favicon: признак наличия и cache-busting превью; null — своего favicon нет. */
  faviconHash: string | null;
  domains: string[];
  clientBotUsername: string | null;
  managerBotUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Число привязанных к компании сущностей — блокируют удаление и показываются на её странице. */
export interface CompanyCounts {
  users: number;
  clients: number;
  documents: number;
}

/** Деталь компании (GET /companies/:id): вид + счётчики привязанных сущностей. */
export interface CompanyDetailView extends CompanyView {
  counts: CompanyCounts;
}

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    @InjectRepository(CompanyDomain) private domainsRepo: Repository<CompanyDomain>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(TelegramUser) private telegramUsersRepo: Repository<TelegramUser>,
    @InjectRepository(Document) private documentsRepo: Repository<Document>,
  ) {}

  async findAll(query: FindCompaniesQueryDto): Promise<PaginatedResponse<CompanyView>> {
    const [data, total] = await this.companiesRepo.findAndCount({
      relations: { domains: true },
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginate(data.map((c) => this.serialize(c)), total, query.page, query.limit);
  }

  async findOne(id: string): Promise<CompanyView> {
    return this.serialize(await this.loadEntity(id));
  }

  /** Деталь компании со счётчиками привязанных сущностей (для её страницы в админке). */
  async getDetail(id: string): Promise<CompanyDetailView> {
    const view = this.serialize(await this.loadEntity(id));
    return { ...view, counts: await this.countRelated(id) };
  }

  async create(dto: CreateCompanyDto): Promise<CompanyView> {
    const name = dto.name.trim();
    const exists = await this.companiesRepo.findOne({ where: { name } });
    if (exists) throw new ConflictException('Company name already in use');
    const slug = await this.normalizeSlug(dto.slug);
    const company = await this.companiesRepo.save(
      this.companiesRepo.create({ name, slug, theme: dto.theme ?? DEFAULT_COMPANY_THEME }),
    );
    if (dto.domains !== undefined) {
      await this.setDomains(company.id, dto.domains);
    }
    return this.findOne(company.id);
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<CompanyView> {
    const company = await this.loadEntity(id);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const exists = await this.companiesRepo.findOne({ where: { name } });
      if (exists && exists.id !== id) throw new ConflictException('Company name already in use');
      company.name = name;
    }
    if (dto.slug !== undefined) {
      company.slug = await this.normalizeSlug(dto.slug, id);
    }
    if (dto.theme !== undefined) {
      company.theme = dto.theme;
    }
    await this.companiesRepo.save(company);
    if (dto.domains !== undefined) {
      await this.setDomains(id, dto.domains);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const company = await this.loadEntity(id);
    // Удаляем только полностью пустую компанию. users/telegram_users.company_id = RESTRICT БД
    // отбила бы и сама, но documents.company_id = SET NULL молча осиротил бы документы — поэтому
    // проверяем все три явно и отдаём понятный 409 вместо сырой ошибки БД. Скоуп — users/clients/
    // documents (leads.company_id тоже SET NULL, но в этот гард сознательно не входит). Домены
    // удаляются каскадом (FK company_domains.company_id = CASCADE).
    const counts = await this.countRelated(id);
    if (counts.users > 0 || counts.clients > 0 || counts.documents > 0) {
      throw new ConflictException(
        'Cannot delete a company while it still has related users, clients or documents',
      );
    }
    await this.companiesRepo.remove(company);
  }

  /** Считает привязанные к компании сущности (для страницы компании и блокировки удаления). */
  private async countRelated(id: string): Promise<CompanyCounts> {
    const [users, clients, documents] = await Promise.all([
      this.usersRepo.count({ where: { companyId: id } }),
      this.telegramUsersRepo.count({ where: { companyId: id } }),
      this.documentsRepo.count({ where: { companyId: id } }),
    ]);
    return { users, clients, documents };
  }

  /**
   * Резолвит брендинг тенанта по домену запроса (для admin-web): имя (для <title> вкладки), тему и
   * версию логотипа (sha256 — cache-busting в URL картинки; null — логотипа нет). Неизвестный/
   * невалидный домен → дефолтная компания. Никогда не бросает — темизация не должна ронять рендер.
   */
  async resolveBrandingByDomain(
    domain?: string,
  ): Promise<{
    name: string | null;
    theme: CompanyTheme;
    logoVersion: string | null;
    faviconVersion: string | null;
    known: boolean;
  }> {
    const matched = await this.findCompanyByDomain(domain);
    const company =
      matched ?? (await this.companiesRepo.findOne({ where: { id: DEFAULT_COMPANY_ID } }));
    return {
      // Имя отдаём только для реального тенанта с привязанным доменом, но не служебную «По умолчанию»
      // (дефолтная компания = бренд DirectPort, admin-web покажет свой дефолтный <title>).
      name: matched && matched.id !== DEFAULT_COMPANY_ID ? matched.name : null,
      theme: normalizeCompanyTheme(company?.theme),
      logoVersion: company?.logoHash ?? null,
      faviconVersion: company?.faviconHash ?? null,
      // known=false — домен не привязан ни к одной компании (брендинг отдан от дефолтной как fallback).
      // admin-web в строгом режиме (env UNKNOWN_TENANT_BEHAVIOR=404) по known=false возвращает 404.
      known: matched != null,
    };
  }

  /**
   * Компания, которой принадлежит домен входа. Используется гейтом входа (AuthService):
   * пользователь не-super_admin должен принадлежать этой компании. Неизвестный домен →
   * дефолтная компания (чтобы вход по bare-домену/localhost работал для дефолтного тенанта).
   */
  async resolveCompanyIdByDomain(domain?: string): Promise<string> {
    const company = await this.findCompanyByDomain(domain);
    return company?.id ?? DEFAULT_COMPANY_ID;
  }

  private async findCompanyByDomain(domain?: string): Promise<Company | null> {
    const normalized = this.tryNormalizeDomain(domain);
    if (!normalized) return null;
    const record = await this.domainsRepo.findOne({
      where: { domain: normalized },
      relations: { company: true },
    });
    return record?.company ?? null;
  }

  private async loadEntity(id: string): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id }, relations: { domains: true } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  private serialize(company: Company): CompanyView {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      theme: normalizeCompanyTheme(company.theme),
      logoHash: company.logoHash ?? null,
      faviconHash: company.faviconHash ?? null,
      domains: (company.domains ?? []).map((d) => d.domain).sort(),
      clientBotUsername: company.clientBotUsername,
      managerBotUsername: company.managerBotUsername,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  /**
   * Замещает набор доменов компании переданным (полная реконсиляция). Нормализует и дедуплицирует
   * вход, отбивает домены, уже занятые другой компанией (понятный ConflictException поверх unique).
   * Delete+insert в одной транзакции, чтобы не оставить компанию без доменов при сбое insert.
   */
  private async setDomains(companyId: string, rawDomains: string[]): Promise<void> {
    const normalized = Array.from(new Set(rawDomains.map((d) => this.normalizeDomain(d))));

    if (normalized.length > 0) {
      const clashes = await this.domainsRepo.find({ where: { domain: In(normalized) } });
      const foreign = clashes.filter((c) => c.companyId !== companyId);
      if (foreign.length > 0) {
        throw new ConflictException(
          `Domain already assigned to another company: ${foreign.map((c) => c.domain).join(', ')}`,
        );
      }
    }

    await this.domainsRepo.manager.transaction(async (em) => {
      await em.delete(CompanyDomain, { companyId });
      if (normalized.length > 0) {
        await em.insert(
          CompanyDomain,
          normalized.map((domain) => ({ companyId, domain })),
        );
      }
    });
  }

  /**
   * Нормализует домен к каноничному host: lowercase, без схемы/userinfo/порта/пути/хвостовой точки.
   * Бросает BadRequest на пустой/битый вход (используется при сохранении из админки).
   */
  private normalizeDomain(raw: string): string {
    let host = (raw ?? '').trim().toLowerCase();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // схема
    host = host.split('/')[0].split('?')[0].split('#')[0]; // путь/query/hash
    const at = host.lastIndexOf('@');
    if (at >= 0) host = host.slice(at + 1); // userinfo
    host = host.replace(/:\d+$/, ''); // порт
    host = host.replace(/\.$/, ''); // хвостовая точка
    if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('-') || host.includes('..')) {
      throw new BadRequestException(`Invalid domain: ${raw}`);
    }
    return host;
  }

  /** Ненавязчивая версия для резолва (пустой/битый домен → null, не бросает). */
  private tryNormalizeDomain(raw: string | undefined | null): string | null {
    if (!raw) return null;
    try {
      return this.normalizeDomain(raw);
    } catch {
      return null;
    }
  }

  /**
   * Нормализует slug (trim + lowercase), пустая строка → null (снять slug). Отбивает
   * зарезервированные значения (затенили бы статические маршруты кабинета) и дубли (явный
   * ConflictException поверх unique-индекса — понятное сообщение оператору).
   */
  private async normalizeSlug(raw: string | undefined, selfId?: string): Promise<string | null> {
    if (raw === undefined) return null;
    const slug = raw.trim().toLowerCase();
    if (slug === '') return null;
    if (RESERVED_SLUGS.includes(slug)) {
      throw new ConflictException(`Slug "${slug}" is reserved`);
    }
    const exists = await this.companiesRepo.findOne({ where: { slug } });
    if (exists && exists.id !== selfId) {
      throw new ConflictException('Company slug already in use');
    }
    return slug;
  }
}
