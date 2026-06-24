import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { PaginatedResponse, paginate } from '../common/interfaces/paginated';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { LeadSearch } from '../database/entities/lead-search.entity';
import { Lead, LeadStatus, type LeadSource } from '../database/entities/lead.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { DiscoverLeadsDto } from './dto/discover-leads.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { ImportLeadItemDto, ImportLeadsDto } from './dto/import-leads.dto';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadEnrichmentService } from './lead-enrichment.service';
import { normalizeDomain, toFetchUrl } from './lead-utils';
import type { DiscoveredCompany } from './lead-discovery.service';

const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'lead.created_at',
  companyName: 'lead.company_name',
  relevanceScore: 'lead.relevance_score',
  status: 'lead.status',
  city: 'lead.city',
};

const EXPORT_CAP = 5000;

@Injectable()
export class LeadsService {
  private logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead) private readonly repo: Repository<Lead>,
    @InjectRepository(LeadSearch) private readonly searchRepo: Repository<LeadSearch>,
    @InjectQueue('lead-discovery') private readonly discoveryQueue: Queue,
    @InjectQueue('lead-enrichment') private readonly enrichmentQueue: Queue,
    private readonly discoveryService: LeadDiscoveryService,
    private readonly enrichmentService: LeadEnrichmentService,
    private readonly managerNotify: ManagerNotifyService,
    @InjectRepository(TelegramUser) private readonly telegramRepo: Repository<TelegramUser>,
  ) {}

  async findAll(query: FindLeadsQueryDto): Promise<PaginatedResponse<Lead>> {
    const qb = this.buildQuery(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, limit);
  }

  async findOne(id: string): Promise<Lead> {
    const lead = await this.repo.findOne({ where: { id }, relations: { convertedClient: true } });
    if (!lead) throw new NotFoundException('Лид не найден');
    return lead;
  }

  /** Счётчики по статусам для бейджей воронки в админке. */
  async getStatusCounts(): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('lead')
      .select('lead.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('lead.status')
      .getRawMany<{ status: LeadStatus; count: string }>();
    const counts: Record<string, number> = {};
    for (const status of Object.values(LeadStatus)) counts[status] = 0;
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }

  /** Ручное создание лида. Дедуп по домену; при наличии сайта ставит enrichment. */
  async create(dto: CreateLeadDto): Promise<Lead> {
    const domain = normalizeDomain(dto.website);
    if (domain) {
      const existing = await this.repo.findOne({ where: { domain } });
      if (existing) {
        throw new BadRequestException(`Лид с доменом ${domain} уже есть (#${existing.id})`);
      }
    }
    const lead = await this.repo.save(
      this.repo.create({
        companyName: dto.companyName,
        website: dto.website ?? null,
        domain,
        inn: dto.inn ?? null,
        city: dto.city ?? null,
        source: 'manual',
        status: LeadStatus.NEW,
      }),
    );
    if (domain) await this.enqueueEnrichment(lead.id);
    return lead;
  }

  async update(
    id: string,
    dto: {
      status?: LeadStatus;
      notes?: string;
      city?: string;
      inn?: string;
      phones?: string[];
      emails?: string[];
      markContacted?: boolean;
    },
  ): Promise<Lead> {
    const lead = await this.findOne(id);
    if (dto.status !== undefined) lead.status = dto.status;
    if (dto.notes !== undefined) lead.notes = dto.notes;
    if (dto.city !== undefined) lead.city = dto.city;
    if (dto.inn !== undefined) lead.inn = dto.inn;
    if (dto.phones !== undefined) lead.phones = dto.phones;
    if (dto.emails !== undefined) lead.emails = dto.emails;
    if (dto.markContacted) lead.lastContactedAt = new Date();
    return this.repo.save(lead);
  }

  async remove(id: string): Promise<void> {
    const res = await this.repo.delete({ id });
    if (!res.affected) throw new NotFoundException('Лид не найден');
  }

  /**
   * Привязать клиента, пришедшего от лида (конверсия). Один клиент — один лид-источник:
   * привязка к второму лиду отклоняется. Статус воронки не трогаем (связь ортогональна).
   */
  async linkClient(id: string, telegramUserId: string): Promise<Lead> {
    const lead = await this.findOne(id);
    const client = await this.telegramRepo.findOne({ where: { id: telegramUserId } });
    if (!client) throw new NotFoundException('Клиент не найден');
    const other = await this.repo.findOne({ where: { convertedTelegramUserId: telegramUserId } });
    if (other && other.id !== id) {
      throw new BadRequestException(`Клиент уже привязан к лиду «${other.companyName}»`);
    }
    const convertedAt = new Date();
    await this.repo.update(id, { convertedTelegramUserId: telegramUserId, convertedAt });
    // Возвращаем уже загруженный лид с проставленной связью — без повторного findOne.
    lead.convertedTelegramUserId = telegramUserId;
    lead.convertedAt = convertedAt;
    lead.convertedClient = client;
    return lead;
  }

  /** Снять привязку клиента (ошибочная конверсия). */
  async unlinkClient(id: string): Promise<Lead> {
    const lead = await this.findOne(id);
    await this.repo.update(id, { convertedTelegramUserId: null, convertedAt: null });
    lead.convertedTelegramUserId = null;
    lead.convertedAt = null;
    lead.convertedClient = null;
    return lead;
  }

  /** Ставит задание discovery в очередь (web-поиск компаний) и пишет запись в журнал. */
  async discover(dto: DiscoverLeadsDto): Promise<{ searchId: string }> {
    if (!this.discoveryService.available) {
      throw new BadRequestException('Discovery недоступен: ANTHROPIC_API_KEY не настроен');
    }
    const maxResults = dto.maxResults ?? 10;
    const search = await this.searchRepo.save(
      this.searchRepo.create({
        query: dto.query,
        city: dto.city ?? null,
        maxResults,
        status: 'running',
      }),
    );
    await this.discoveryQueue.add('discover-leads', {
      searchId: search.id,
      query: dto.query,
      city: dto.city,
      maxResults,
    });
    return { searchId: search.id };
  }

  /** История discovery-заданий (последние N), новые сверху. */
  getSearchHistory(limit = 20): Promise<LeadSearch[]> {
    return this.searchRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /** Дайджест свежих горячих лидов за период — для отчёта автономного агента. */
  getDigest(hours: number, minScore = 0.7): Promise<Lead[]> {
    const since = new Date(Date.now() - hours * 3600_000);
    return this.repo.find({
      where: { createdAt: MoreThanOrEqual(since), relevanceScore: MoreThanOrEqual(minScore) },
      order: { relevanceScore: 'DESC' },
      take: 50,
    });
  }

  /** Передать текстовый отчёт агента менеджерам в Telegram (через manager-bot). */
  reportToManagers(text: string): Promise<{ delivered: boolean }> {
    return this.managerNotify.notifyLeadsReport(text);
  }

  /** Воркер: завершить задание поиска с результатами. */
  async completeSearch(
    id: string,
    counts: { found: number; created: number; skipped: number },
  ): Promise<void> {
    await this.searchRepo.update(id, {
      status: 'completed',
      foundCount: counts.found,
      createdCount: counts.created,
      skippedCount: counts.skipped,
      finishedAt: new Date(),
    });
  }

  /** Воркер: пометить задание поиска упавшим. */
  async failSearch(id: string, error: string): Promise<void> {
    await this.searchRepo.update(id, {
      status: 'failed',
      errorMessage: error,
      finishedAt: new Date(),
    });
  }

  /** Перезапускает обогащение конкретного лида. */
  async reenrich(id: string): Promise<{ queued: boolean }> {
    const lead = await this.findOne(id);
    if (!toFetchUrl(lead.website)) {
      throw new BadRequestException('У лида нет сайта — обогащать нечего');
    }
    if (!this.enrichmentService.available) {
      throw new BadRequestException('Обогащение недоступно: ANTHROPIC_API_KEY не настроен');
    }
    await this.enqueueEnrichment(id);
    return { queued: true };
  }

  /** Массовый импорт (реестр ФТС / CSV). Дедуп по домену, опц. enrichment. */
  async import(dto: ImportLeadsDto): Promise<{ created: number; skipped: number }> {
    return this.insertMany(dto.items, {
      source: dto.source ?? 'fts_registry',
      autoEnrich: dto.autoEnrich ?? true,
      sourceDetail: null,
    });
  }

  /** Вызывается воркером discovery: сохраняет найденные компании как лиды. */
  async saveDiscovered(
    companies: DiscoveredCompany[],
    sourceDetail: string,
  ): Promise<{ created: number; skipped: number }> {
    return this.insertMany(
      companies.map((c) => ({
        companyName: c.name,
        website: c.website ?? undefined,
        city: c.city ?? undefined,
      })),
      { source: 'web_search', autoEnrich: true, sourceDetail },
    );
  }

  async exportCsv(query: FindLeadsQueryDto): Promise<string> {
    const leads = await this.buildQuery(query).take(EXPORT_CAP).getMany();
    return toCsv(leads);
  }

  // --- внутреннее ---

  private buildQuery(query: FindLeadsQueryDto) {
    const qb = this.repo.createQueryBuilder('lead');
    if (query.status) qb.andWhere('lead.status = :status', { status: query.status });
    if (query.source) qb.andWhere('lead.source = :source', { source: query.source });
    if (query.minScore != null) {
      qb.andWhere('lead.relevance_score >= :minScore', { minScore: query.minScore });
    }
    if (query.search) {
      qb.andWhere(
        '(lead.company_name ILIKE :s OR lead.city ILIKE :s OR lead.domain ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    const sortColumn = SORT_COLUMNS[query.sortBy] ?? SORT_COLUMNS.createdAt;
    qb.orderBy(sortColumn, query.sortOrder, 'NULLS LAST');
    return qb;
  }

  private async insertMany(
    items: Pick<ImportLeadItemDto, 'companyName' | 'website' | 'inn' | 'city'>[],
    opts: { source: LeadSource; autoEnrich: boolean; sourceDetail: string | null },
  ): Promise<{ created: number; skipped: number }> {
    let skipped = 0;

    // Дедуп внутри пачки по нормализованному домену.
    const seenDomains = new Set<string>();
    const candidates: { item: (typeof items)[number]; domain: string | null }[] = [];
    for (const item of items) {
      const domain = normalizeDomain(item.website);
      if (domain) {
        if (seenDomains.has(domain)) {
          skipped++;
          continue;
        }
        seenDomains.add(domain);
      }
      candidates.push({ item, domain });
    }

    // Один запрос: какие из доменов уже есть в БД (вместо проверки по строке).
    const existing =
      seenDomains.size > 0
        ? new Set(
            (
              await this.repo.find({ where: { domain: In([...seenDomains]) }, select: ['domain'] })
            ).map((l) => l.domain),
          )
        : new Set<string | null>();

    const toCreate: Lead[] = [];
    for (const { item, domain } of candidates) {
      if (domain && existing.has(domain)) {
        skipped++;
        continue;
      }
      toCreate.push(
        this.repo.create({
          companyName: item.companyName,
          website: item.website ?? null,
          domain,
          inn: item.inn ?? null,
          city: item.city ?? null,
          source: opts.source,
          sourceDetail: opts.sourceDetail,
          status: LeadStatus.NEW,
        }),
      );
    }

    // Один батчевый insert (TypeORM проставит id), один addBulk на обогащение.
    const saved = toCreate.length > 0 ? await this.repo.save(toCreate) : [];
    if (opts.autoEnrich) {
      const jobs = saved
        .filter((l) => l.domain)
        .map((l) => ({ name: 'enrich-lead', data: { leadId: l.id } }));
      if (jobs.length > 0) await this.enrichmentQueue.addBulk(jobs);
    }

    this.logger.log(`Импорт лидов (${opts.source}): создано ${saved.length}, пропущено ${skipped}`);
    return { created: saved.length, skipped };
  }

  private async enqueueEnrichment(leadId: string): Promise<void> {
    await this.enrichmentQueue.add('enrich-lead', { leadId });
  }
}

/** Один столбец CSV: экранирование кавычек + защита от формул Excel (CSV-инъекция). */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(leads: Lead[]): string {
  const header = [
    'Компания',
    'ИНН',
    'Город',
    'Сайт',
    'Телефоны',
    'Email',
    'Импортёр',
    'Скор',
    'Обоснование',
    'Статус',
    'Источник',
    'Заметки',
    'Создан',
  ];
  const rows = leads.map((l) =>
    [
      l.companyName,
      l.inn,
      l.city,
      l.website,
      (l.phones ?? []).join(' '),
      (l.emails ?? []).join(' '),
      l.doesImport == null ? '' : l.doesImport ? 'да' : 'нет',
      l.relevanceScore == null ? '' : l.relevanceScore.toFixed(2),
      l.relevanceReason,
      l.statusLabel,
      l.source,
      l.notes,
      l.createdAt.toISOString().slice(0, 10),
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM — чтобы Excel открыл UTF-8 кириллицу корректно.
  return '﻿' + [header.map(csvCell).join(','), ...rows].join('\r\n');
}
