import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';

function createService() {
  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x: Record<string, unknown>) => x),
    save: jest.fn(async (x: unknown) =>
      Array.isArray(x)
        ? x.map((e, i) => ({ id: `lead-${i + 1}`, ...(e as object) }))
        : { id: 'lead-1', ...(x as object) },
    ),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };
  const searchRepo = {
    create: jest.fn((x: Record<string, unknown>) => x),
    save: jest.fn(async (x: Record<string, unknown>) => ({ id: 'search-1', ...x })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    find: jest.fn().mockResolvedValue([]),
  };
  const discoveryQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const enrichmentQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    addBulk: jest.fn().mockResolvedValue(undefined),
  };
  const discoveryService = { available: true };
  const enrichmentService = { available: true };
  const managerNotify = { notifyLeadsReport: jest.fn().mockResolvedValue({ delivered: true }) };
  const service = new LeadsService(
    repo as never,
    searchRepo as never,
    discoveryQueue as never,
    enrichmentQueue as never,
    discoveryService as never,
    enrichmentService as never,
    managerNotify as never,
  );
  return { service, repo, searchRepo, discoveryQueue, enrichmentQueue, managerNotify };
}

describe('LeadsService.create', () => {
  it('создаёт лид и ставит обогащение при наличии сайта', async () => {
    const { service, repo, enrichmentQueue } = createService();
    await service.create({ companyName: 'ВЭД-Сервис', website: 'ved.ru' });
    expect(repo.save).toHaveBeenCalled();
    expect(enrichmentQueue.add).toHaveBeenCalledWith('enrich-lead', { leadId: 'lead-1' });
  });

  it('дедуп: лид с тем же доменом → BadRequest, без enqueue', async () => {
    const { service, repo, enrichmentQueue } = createService();
    repo.findOne.mockResolvedValue({ id: 'x', domain: 'ved.ru' });
    await expect(service.create({ companyName: 'Дубль', website: 'https://www.ved.ru' })).rejects.toThrow(
      BadRequestException,
    );
    expect(enrichmentQueue.add).not.toHaveBeenCalled();
  });

  it('без сайта — создаёт, но обогащение не ставит', async () => {
    const { service, repo, enrichmentQueue } = createService();
    await service.create({ companyName: 'Без сайта' });
    expect(repo.save).toHaveBeenCalled();
    expect(enrichmentQueue.add).not.toHaveBeenCalled();
  });
});

describe('LeadsService.discover', () => {
  it('создаёт запись поиска и ставит job с searchId', async () => {
    const { service, searchRepo, discoveryQueue } = createService();
    const res = await service.discover({ query: 'таможня Москва', city: 'Москва', maxResults: 10 });
    expect(res).toEqual({ searchId: 'search-1' });
    expect(searchRepo.save).toHaveBeenCalled();
    expect(discoveryQueue.add).toHaveBeenCalledWith(
      'discover-leads',
      expect.objectContaining({ searchId: 'search-1', query: 'таможня Москва' }),
    );
  });
});

describe('LeadsService.import', () => {
  it('дедуп внутри одной пачки по нормализованному домену', async () => {
    const { service } = createService();
    const res = await service.import({
      items: [
        { companyName: 'A', website: 'http://a.ru' },
        { companyName: 'A-зеркало', website: 'https://www.a.ru/contacts' },
        { companyName: 'B', website: 'b.ru' },
      ],
    });
    expect(res).toEqual({ created: 2, skipped: 1 });
  });

  it('дедуп против уже существующих в БД одним запросом', async () => {
    const { service, repo, enrichmentQueue } = createService();
    repo.find.mockResolvedValue([{ domain: 'exist.ru' }]);
    const res = await service.import({
      items: [
        { companyName: 'X', website: 'exist.ru' },
        { companyName: 'Y', website: 'new.ru' },
      ],
    });
    expect(res).toEqual({ created: 1, skipped: 1 });
    // одна проверка дублей вместо построчной
    expect(repo.find).toHaveBeenCalledTimes(1);
    // обогащение ставится батчем только для созданного с доменом
    expect(enrichmentQueue.addBulk).toHaveBeenCalledWith([
      { name: 'enrich-lead', data: { leadId: 'lead-1' } },
    ]);
  });

  it('autoEnrich=false — лиды создаются без постановки обогащения', async () => {
    const { service, enrichmentQueue } = createService();
    await service.import({ items: [{ companyName: 'Z', website: 'z.ru' }], autoEnrich: false });
    expect(enrichmentQueue.addBulk).not.toHaveBeenCalled();
  });
});

describe('LeadsService.exportCsv', () => {
  it('экранирует формулы (CSV-инъекция), кавычки и пишет BOM', async () => {
    const { service, repo } = createService();
    const leads = [
      {
        companyName: '=SUM(1)',
        inn: null,
        city: 'ООО "Рога, Копыта"',
        website: null,
        phones: ['+7 900'],
        emails: null,
        doesImport: true,
        relevanceScore: 0.9,
        relevanceReason: null,
        statusLabel: 'Новый',
        source: 'manual',
        notes: null,
        createdAt: new Date('2026-06-21T00:00:00Z'),
      },
    ];
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(leads),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const csv = await service.exportCsv({
      page: 1,
      limit: 20,
      sortOrder: 'DESC',
      sortBy: 'createdAt',
    } as never);

    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM для Excel
    expect(csv).toContain("'=SUM(1)"); // формула обезврежена ведущим апострофом
    expect(csv).toContain('"ООО ""Рога, Копыта"""'); // кавычки и запятая экранированы
  });
});

describe('LeadsService.reportToManagers', () => {
  it('делегирует доставку отчёта менеджерам', async () => {
    const { service, managerNotify } = createService();
    const res = await service.reportToManagers('Найдено 5 горячих лидов');
    expect(managerNotify.notifyLeadsReport).toHaveBeenCalledWith('Найдено 5 горячих лидов');
    expect(res).toEqual({ delivered: true });
  });
});

describe('LeadsService.getDigest', () => {
  it('запрашивает свежих лидов и возвращает их', async () => {
    const { service, repo } = createService();
    const leads = [{ id: 'l1', relevanceScore: 0.9 }];
    repo.find.mockResolvedValue(leads);
    const res = await service.getDigest(24);
    expect(repo.find).toHaveBeenCalled();
    expect(res).toBe(leads);
  });
});
