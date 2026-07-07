import { ClientCodeCatalogService } from './client-code-catalog.service';
import type { ClientProductCode } from '../database/entities/client-product-code.entity';
import type { Document } from '../database/entities/document.entity';

const TNVED = {
  CODE: '8509101000',
  KR_NAIM: 'Пылесосы бытовые',
  TNVED: { IMP: 10, NDS: 20, AKC: 0 },
};

function createService(opts: { entries?: Partial<ClientProductCode>[]; tksFails?: boolean } = {}) {
  const executeMock = jest.fn().mockResolvedValue(undefined);
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: executeMock,
  };
  const repo = {
    find: jest.fn().mockResolvedValue(opts.entries ?? []),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    query: jest.fn().mockResolvedValue(undefined),
  };
  const tksApi = {
    getTnvedCode: opts.tksFails
      ? jest.fn().mockRejectedValue(new Error('TKS down'))
      : jest.fn().mockResolvedValue(TNVED),
  };
  const service = new ClientCodeCatalogService(repo as never, tksApi as never);
  return { service, repo, tksApi, qb };
}

const doc = {
  companyId: 'company-1',
  telegramUserId: 'client-1',
  language: null,
} as unknown as Document;

describe('ClientCodeCatalogService', () => {
  describe('buildProductKey', () => {
    it('нормализует регистр и пробелы описания', () => {
      const { service } = createService();
      expect(service.buildProductKey('Пылесос   БЫТОВОЙ ')).toBe(
        service.buildProductKey('пылесос бытовой'),
      );
    });

    it('артикул различает товары с одинаковым описанием', () => {
      const { service } = createService();
      expect(service.buildProductKey('Пылесос', { article: 'A-1' })).not.toBe(
        service.buildProductKey('Пылесос', { article: 'A-2' }),
      );
    });

    it('прочие атрибуты (материал, бренд) на ключ не влияют', () => {
      const { service } = createService();
      expect(service.buildProductKey('Пылесос', { material: 'пластик' })).toBe(
        service.buildProductKey('Пылесос', { brand: 'Acme' }),
      );
    });
  });

  describe('classifyFromCatalog', () => {
    const row = { description: 'Пылесос', quantity: 1, price: 10, weight: 2 };

    it('без telegramUserId каталог не используется', async () => {
      const { service, repo } = createService();
      const result = await service.classifyFromCatalog(
        { ...doc, telegramUserId: null } as never,
        [row],
      );
      expect(result).toEqual([null]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('хит: ClassifiedProduct со ставками TKS, codeSource=catalog, обновляет счётчик', async () => {
      const { service, qb } = createService({
        entries: [
          {
            id: 'entry-1',
            productKey: createService().service.buildProductKey('Пылесос'),
            tnVedCode: '8509101000',
            source: 'auto',
            matchConfidence: 0.9,
          },
        ],
      });
      const [product] = await service.classifyFromCatalog(doc, [row]);
      expect(product).toMatchObject({
        tnVedCode: '8509101000',
        dutyRate: 10,
        vatRate: 20,
        matched: true,
        verified: true,
        matchConfidence: 0.9,
        codeSource: 'catalog',
      });
      expect(product?.notes?.[0]?.message).toContain('каталога подтверждённых кодов');
      expect(qb.execute).toHaveBeenCalled();
    });

    it('manual-запись даёт полную уверенность', async () => {
      const { service } = createService({
        entries: [
          {
            id: 'entry-1',
            productKey: createService().service.buildProductKey('Пылесос'),
            tnVedCode: '8509101000',
            source: 'manual',
            matchConfidence: 0.5,
          },
        ],
      });
      const [product] = await service.classifyFromCatalog(doc, [row]);
      expect(product?.matchConfidence).toBe(1);
    });

    it('сбой TKS по коду из каталога → строка идёт обычным путём (null)', async () => {
      const { service } = createService({
        tksFails: true,
        entries: [
          {
            id: 'entry-1',
            productKey: createService().service.buildProductKey('Пылесос'),
            tnVedCode: '8509101000',
            source: 'auto',
            matchConfidence: 0.9,
          },
        ],
      });
      const result = await service.classifyFromCatalog(doc, [row]);
      expect(result).toEqual([null]);
    });

    it('сбой БД каталога не бросает — все строки мимо каталога', async () => {
      const { service, repo } = createService();
      repo.find.mockRejectedValue(new Error('db down'));
      const result = await service.classifyFromCatalog(doc, [row]);
      expect(result).toEqual([null]);
    });
  });

  describe('recordFromResult', () => {
    const baseRow = {
      description: 'Пылесос',
      tnVedCode: '8509101000',
      matched: true,
      matchConfidence: 0.92,
      verificationStatus: 'exact',
      codeSource: 'ai',
    };

    it('пишет только exact-строки с кодом от классификатора', async () => {
      const { service, repo } = createService();
      await service.recordFromResult({
        ...doc,
        id: 'doc-1',
        resultData: [
          baseRow,
          { ...baseRow, verificationStatus: 'review' },
          { ...baseRow, codeSource: 'catalog' },
          { ...baseRow, codeSource: 'manual' },
          { ...baseRow, tnVedCode: '' },
        ],
      } as never);
      expect(repo.query).toHaveBeenCalledTimes(1);
      const params = repo.query.mock.calls[0][1];
      expect(params).toEqual(
        expect.arrayContaining(['company-1', 'client-1', '8509101000', 'auto', 0.92]),
      );
    });

    it('без telegramUserId ничего не пишет', async () => {
      const { service, repo } = createService();
      await service.recordFromResult({
        ...doc,
        id: 'doc-1',
        telegramUserId: null,
        resultData: [baseRow],
      } as never);
      expect(repo.query).not.toHaveBeenCalled();
    });

    it('сбой upsert только логируется', async () => {
      const { service, repo } = createService();
      repo.query.mockRejectedValue(new Error('db down'));
      await expect(
        service.recordFromResult({ ...doc, id: 'doc-1', resultData: [baseRow] } as never),
      ).resolves.toBeUndefined();
    });
  });

  describe('recordManualCode', () => {
    it('пишет source=manual с полной уверенностью', async () => {
      const { service, repo } = createService();
      await service.recordManualCode(
        { id: 'doc-1', companyId: 'company-1', telegramUserId: 'client-1' } as never,
        { description: 'Пылесос', attributes: { article: 'A-1' } },
        '8509101000',
      );
      expect(repo.query).toHaveBeenCalledTimes(1);
      const params = repo.query.mock.calls[0][1];
      expect(params).toEqual(expect.arrayContaining(['manual', 1, 'A-1']));
    });
  });
});
