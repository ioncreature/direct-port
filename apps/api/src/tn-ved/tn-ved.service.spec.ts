import type { TnvedCode } from '@direct-port/tks-api';
import { TnVedService } from './tn-ved.service';

function makeTnved(overrides: Partial<TnvedCode> = {}): TnvedCode {
  return {
    CODE: '6109100010',
    KR_NAIM: 'Футболки',
    TNVED: { IMP: 12.5, NDS: 20, AKC: 0 },
    TNVEDALL: {},
    ...(overrides as Record<string, unknown>),
  } as unknown as TnvedCode;
}

function makeClaudeResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

interface CreateOpts {
  anthropicEnabled?: boolean;
  translationText?: string;
  searchResults?: Array<{ CODE: string; KR_NAIM: string; CNT: number }>;
  tnvedByCode?: Record<string, TnvedCode>;
  tnvedLookupError?: Error;
}

function createService(opts: CreateOpts = {}) {
  const anthropicEnabled = opts.anthropicEnabled ?? true;
  const tnvedByCode = opts.tnvedByCode ?? { '6109100010': makeTnved() };

  const tnVedRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const aiUsageLogRepo = {
    save: jest.fn().mockResolvedValue(undefined),
  };

  const tksApi = {
    searchGoodsGrouped: jest
      .fn()
      .mockResolvedValue({ data: opts.searchResults ?? [], hm: opts.searchResults?.length ?? 0 }),
    searchGoodsByCode: jest.fn().mockResolvedValue({ data: [], hm: 0 }),
    getTnvedCode: jest.fn().mockImplementation(async (code: string) => {
      if (opts.tnvedLookupError) throw opts.tnvedLookupError;
      const t = tnvedByCode[code];
      if (!t) throw new Error(`TNVED ${code} not found`);
      return t;
    }),
  };

  const countriesService = {
    findByCode: jest.fn().mockResolvedValue(null),
  };

  const aiConfig = {
    getQueryFormulationModel: jest.fn().mockResolvedValue('claude-haiku-4-5'),
  };

  const regulatoryService = {
    buildReport: jest
      .fn()
      .mockResolvedValue({ groups: [], summary: { totalItems: 0, byCategory: {} } }),
  };

  const regulatoryInterpreter = {
    explain: jest.fn().mockResolvedValue({ byId: new Map() }),
  };

  const anthropic = anthropicEnabled
    ? {
        messages: {
          create: jest
            .fn()
            .mockResolvedValue(makeClaudeResponse(opts.translationText ?? 'translated')),
        },
      }
    : null;

  const service = new TnVedService(
    tnVedRepo as never,
    aiUsageLogRepo as never,
    tksApi as never,
    countriesService as never,
    aiConfig as never,
    regulatoryService as never,
    regulatoryInterpreter as never,
    anthropic as never,
  );

  return { service, tnVedRepo, tksApi, aiConfig, anthropic, regulatoryService, regulatoryInterpreter };
}

describe('TnVedService', () => {
  describe('searchTks routing', () => {
    it('returns an empty response for whitespace queries', async () => {
      const { service, tksApi } = createService();
      const result = await service.searchTks('   ');
      expect(result).toEqual({ mode: 'text_search', query: '', results: [], totalFound: 0 });
      expect(tksApi.getTnvedCode).not.toHaveBeenCalled();
      expect(tksApi.searchGoodsGrouped).not.toHaveBeenCalled();
    });

    it('routes a 10-digit numeric query through lookupCode (code_lookup mode)', async () => {
      const { service, tksApi } = createService({
        tnvedByCode: { '6109100010': makeTnved() },
      });
      const result = await service.searchTks('6109100010');
      expect(result.mode).toBe('code_lookup');
      expect(tksApi.getTnvedCode).toHaveBeenCalledWith('6109100010');
    });

    it('pads a partial numeric query to 10 digits with trailing zeros', async () => {
      const { service, tksApi } = createService({
        tnvedByCode: { '6109000000': makeTnved({ CODE: '6109000000' }) },
      });
      await service.searchTks('6109');
      expect(tksApi.getTnvedCode).toHaveBeenCalledWith('6109000000');
    });

    it('accepts numeric queries with dots and spaces (cleaned before isCodeQuery)', async () => {
      const { service, tksApi } = createService({
        tnvedByCode: { '6109100010': makeTnved() },
      });
      await service.searchTks('6109.10.00.10');
      expect(tksApi.getTnvedCode).toHaveBeenCalledWith('6109100010');
    });

    it('routes a text query through searchByText (text_search mode)', async () => {
      const { service, tksApi } = createService({
        searchResults: [{ CODE: '6109100010', KR_NAIM: 'Футболки', CNT: 100 }],
        tnvedByCode: { '6109100010': makeTnved() },
      });
      const result = await service.searchTks('футболки');
      expect(result.mode).toBe('text_search');
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalled();
    });

    it('falls back to text search when code lookup throws', async () => {
      const { service, tksApi } = createService({
        tnvedLookupError: new Error('TKS 500'),
        searchResults: [],
      });
      const result = await service.searchTks('6109');
      expect(result.mode).toBe('text_search');
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalled();
    });
  });

  describe('translateToRussian (via searchByText)', () => {
    it('skips Claude when the query is already mostly Cyrillic', async () => {
      const { service, anthropic } = createService();
      await service.searchTks('футболки хлопок');
      expect(anthropic!.messages.create).not.toHaveBeenCalled();
    });

    it('calls Claude with the original query for Latin text', async () => {
      const { service, anthropic } = createService({ translationText: 'футболка хлопок' });
      await service.searchTks('cotton t-shirt');
      expect(anthropic!.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining('cotton t-shirt'),
            }),
          ],
        }),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });

    it('falls back to the original query when Claude throws', async () => {
      const { service, anthropic, tksApi } = createService();
      anthropic!.messages.create.mockRejectedValueOnce(new Error('Claude down'));
      await service.searchTks('cotton');
      // TKS still gets called — with the original query, not the translation.
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledWith('cotton');
    });

    it('skips Claude entirely when Anthropic client is not wired (graceful degradation)', async () => {
      const { service, tksApi } = createService({ anthropicEnabled: false });
      await service.searchTks('cotton');
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledWith('cotton');
    });

    it('caches the translation: a repeat query does not hit Claude twice', async () => {
      const { service, anthropic } = createService({ translationText: 'футболка' });
      await service.searchTks('t-shirt');
      await service.searchTks('t-shirt');
      await service.searchTks('T-Shirt'); // cache key is lowercased
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(1);
    });

    it('logs translate token usage in ai_usage_log on success', async () => {
      const { service, anthropic } = createService({ translationText: 'футболка' });
      const aiUsageLogRepo = (service as unknown as {
        aiUsageLogRepo: { save: jest.Mock };
      }).aiUsageLogRepo;
      await service.searchTks('t-shirt');
      expect(anthropic!.messages.create).toHaveBeenCalled();
      expect(aiUsageLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'translate', inputTokens: 10, outputTokens: 5 }),
      );
    });
  });

  describe('findByCode (local DB lookup)', () => {
    it('delegates to repository.findOne with the exact code', async () => {
      const { service, tnVedRepo } = createService();
      await service.findByCode('6109100010');
      expect(tnVedRepo.findOne).toHaveBeenCalledWith({ where: { code: '6109100010' } });
    });
  });

  describe('search (local DB query builder)', () => {
    it('builds a LIKE/ILIKE query with the input', async () => {
      const { service, tnVedRepo } = createService();
      await service.search('6109');
      expect(tnVedRepo.createQueryBuilder).toHaveBeenCalledWith('t');
    });
  });

  describe('getRegulatoryExplanations', () => {
    it('returns an empty object when the TNVED has no regulatory items', async () => {
      const { service, regulatoryInterpreter } = createService();
      const result = await service.getRegulatoryExplanations('6109100010');
      expect(result).toEqual({});
      // explain is not called when there are no items to interpret.
      expect(regulatoryInterpreter.explain).not.toHaveBeenCalled();
    });
  });
});
