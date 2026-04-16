import { ClassifierService, type ProductRow } from './classifier.service';
import type { TnvedCode } from '@direct-port/tks-api';

function makeProduct(desc: string, overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    description: desc,
    quantity: 10,
    price: 100,
    weight: 2,
    notes: [],
    ...overrides,
  };
}

function makeTnvedCode(code: string, overrides: Partial<TnvedCode['TNVED']> = {}): TnvedCode {
  return {
    CODE: code,
    KR_NAIM: `Описание ${code}`,
    TNVED: {
      IMP: 5,
      IMPSIGN: null,
      IMP2: null,
      IMPEDI2: null,
      NDS: 20,
      AKC: 0,
      ...overrides,
    } as any,
  };
}

function makeSearchResult(code: string, name: string, cnt = 90, hm = 100) {
  return { data: [{ CODE: code, KR_NAIM: name, CNT: cnt }], hm };
}

function makeClaudeSelection(overrides: Record<string, any> = {}) {
  return {
    index: 0,
    tnVedCode: '0000000000',
    confidence: 0.9,
    comment: 'ok',
    fromCandidates: true,
    ...overrides,
  };
}

function createService(opts: {
  searchResults?: Record<string, { data: any[]; hm: number }>;
  tnvedCodes?: Record<string, TnvedCode>;
  claudeResponse?: any[];
  claudeEnabled?: boolean;
  queryFormulationResults?: Array<{ index: number; queries: string[] }>;
} = {}) {
  const searchResults = opts.searchResults ?? {};
  const tnvedCodes = opts.tnvedCodes ?? {};
  const claudeEnabled = opts.claudeEnabled ?? true;

  const tksApi = {
    searchGoodsGrouped: jest.fn().mockImplementation((desc: string) => {
      return Promise.resolve(searchResults[desc] ?? { data: [], hm: 0 });
    }),
    getTnvedCode: jest.fn().mockImplementation((code: string) => {
      const tnved = tnvedCodes[code];
      if (!tnved) return Promise.reject(new Error(`TNVED ${code} not found`));
      return Promise.resolve(tnved);
    }),
  };

  const anthropic = claudeEnabled
    ? {
        messages: {
          create: jest.fn().mockImplementation((params: any) => {
            const toolName = params.tools?.[0]?.name;
            if (toolName === 'formulate_search_queries') {
              // Default: pass descriptions through as single-element arrays
              const userContent = JSON.parse(params.messages[0].content);
              const products = opts.queryFormulationResults ??
                userContent.map((item: any) => ({ index: item.index, queries: [item.description] }));
              return Promise.resolve({
                content: [{ type: 'tool_use', id: 'toolu_q', name: 'formulate_search_queries', input: { products } }],
                usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
              });
            }
            return Promise.resolve({
              content: [{ type: 'tool_use', id: 'toolu_mock', name: 'classify_products', input: { items: opts.claudeResponse ?? [] } }],
              usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            });
          }),
        },
      }
    : null;

  const aiConfig = {
    getClassifierModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
    getQueryFormulationModel: jest.fn().mockResolvedValue('claude-haiku-4-5-20251001'),
  };

  const service = new ClassifierService(tksApi as any, anthropic as any, aiConfig as any);
  return { service, tksApi, anthropic, aiConfig };
}

/** Count only classification calls (not query formulation) */
function classificationCallCount(anthropic: { messages: { create: jest.Mock } }): number {
  return anthropic.messages.create.mock.calls.filter(
    (call: any[]) => call[0]?.tools?.[0]?.name === 'classify_products',
  ).length;
}

describe('ClassifierService', () => {
  describe('Полный цикл classify: TKS → Claude → сборка', () => {
    it('классифицирует товар с кандидатом TKS + подтверждением Claude', async () => {
      const { service } = createService({
        searchResults: { 'Электрический чайник': makeSearchResult('8516101000', 'Чайники электрические') },
        tnvedCodes: { '8516101000': makeTnvedCode('8516101000', { IMP: 7.5, NDS: 20 }) },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '8516101000', confidence: 0.95, comment: 'Чайник электрический' })],
      });

      const result = await service.classify([makeProduct('Электрический чайник')]);
      const p = result.products[0];

      expect(p.tnVedCode).toBe('8516101000');
      expect(p.tnVedDescription).toBe('Описание 8516101000');
      expect(p.dutyRate).toBe(7.5);
      expect(p.vatRate).toBe(20);
      expect(p.matchConfidence).toBe(0.95);
      expect(p.matched).toBe(true);
      expect(p.verified).toBe(true);
      expect(p.suggestedCode).toBeNull();
    });

    it('suggestedCode когда Claude предлагает свой код (fromCandidates=false)', async () => {
      const { service } = createService({
        searchResults: { 'Специальный товар': { data: [], hm: 0 } },
        tnvedCodes: { '1234567890': makeTnvedCode('1234567890') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '1234567890', confidence: 0.8, comment: 'Предложен вручную', fromCandidates: false })],
      });

      const result = await service.classify([makeProduct('Специальный товар')]);
      expect(result.products[0].suggestedCode).toBe('1234567890');
    });
  });

  describe('Unmatched (код не найден)', () => {
    it('помечает как unmatched если TKS не вернул кандидатов и Claude не помог', async () => {
      const { service } = createService({
        searchResults: { 'Неизвестный товар': { data: [], hm: 0 } },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '9999999999', confidence: 0.3, comment: 'не уверен', fromCandidates: false })],
      });

      const result = await service.classify([makeProduct('Неизвестный товар')]);
      const p = result.products[0];

      expect(p.matched).toBe(false);
      expect(p.tnVedCode).toBe('');
      expect(p.tnVedDescription).toBe('Не найден');
      expect(p.dutyRate).toBe(0);
      expect(p.vatRate).toBe(20);
      expect(p.suggestedCode).toBe('9999999999');
      expect(p.notes.some((n) => n.severity === 'blocker' && n.field === 'code')).toBe(true);
    });
  });

  describe('Notes (заметки классификатора)', () => {
    it('добавляет warning при низкой уверенности (ниже порога)', async () => {
      const { service } = createService({
        searchResults: { 'Сомнительный товар': makeSearchResult('1111111111', 'Что-то', 50) },
        tnvedCodes: { '1111111111': makeTnvedCode('1111111111') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '1111111111', confidence: 0.5, comment: 'Не уверен' })],
      });

      const result = await service.classify([makeProduct('Сомнительный товар')]);
      const warnings = result.products[0].notes.filter(
        (n) => n.severity === 'warning' && n.field === 'code',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('0.50');
    });

    it('добавляет info-ноту с комментарием при высокой уверенности', async () => {
      const { service } = createService({
        searchResults: { 'Товар': makeSearchResult('2222222222', 'Товар', 80) },
        tnvedCodes: { '2222222222': makeTnvedCode('2222222222') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '2222222222', comment: 'Точное совпадение' })],
      });

      const result = await service.classify([makeProduct('Товар')]);
      const infos = result.products[0].notes.filter(
        (n) => n.severity === 'info' && n.field === 'code',
      );
      expect(infos).toHaveLength(1);
      expect(infos[0].message).toContain('Точное совпадение');
    });

    it('не добавляет warning при confidence выше переданного порога', async () => {
      const { service } = createService({
        searchResults: { 'Товар': makeSearchResult('7777777777', 'Товар') },
        tnvedCodes: { '7777777777': makeTnvedCode('7777777777') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '7777777777', confidence: 0.75, comment: 'ok' })],
      });

      const result = await service.classify([makeProduct('Товар')], undefined, 0.7);
      const warnings = result.products[0].notes.filter(
        (n) => n.severity === 'warning' && n.field === 'code',
      );
      expect(warnings).toHaveLength(0);
    });

    it('добавляет warning при confidence ниже переданного порога', async () => {
      const { service } = createService({
        searchResults: { 'Товар': makeSearchResult('8888888888', 'Товар') },
        tnvedCodes: { '8888888888': makeTnvedCode('8888888888') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '8888888888', confidence: 0.85, comment: 'средне' })],
      });

      const result = await service.classify([makeProduct('Товар')], undefined, 0.9);
      const warnings = result.products[0].notes.filter(
        (n) => n.severity === 'warning' && n.field === 'code',
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('0.85');
    });

    it('добавляет warning при отсутствии Claude (TKS-only)', async () => {
      const { service } = createService({
        claudeEnabled: false,
        searchResults: { 'Товар без AI': makeSearchResult('3333333333', 'Товар', 70) },
        tnvedCodes: { '3333333333': makeTnvedCode('3333333333') },
      });

      const result = await service.classify([makeProduct('Товар без AI')]);
      const p = result.products[0];
      expect(p.verified).toBe(false);
      expect(p.notes.some((n) => n.severity === 'warning' && n.message.includes('TKS'))).toBe(true);
    });

    it('сохраняет входные notes от парсера', async () => {
      const inputNote = { stage: 'parse' as const, severity: 'info' as const, message: 'Переведено с китайского' };
      const { service } = createService({
        searchResults: { 'Товар с нотой': makeSearchResult('4444444444', 'Товар') },
        tnvedCodes: { '4444444444': makeTnvedCode('4444444444') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '4444444444', confidence: 0.95, comment: 'ok' })],
      });

      const result = await service.classify([makeProduct('Товар с нотой', { notes: [inputNote] })]);
      expect(result.products[0].notes).toContainEqual(inputNote);
    });

    it('comment_localized попадает в messageLocalized при language != ru', async () => {
      const { service } = createService({
        searchResults: { 'Kettle': makeSearchResult('8516101000', 'Чайники') },
        tnvedCodes: { '8516101000': makeTnvedCode('8516101000') },
        claudeResponse: [makeClaudeSelection({
          tnVedCode: '8516101000',
          confidence: 0.5,
          comment: 'Электрочайник',
          comment_localized: 'Electric kettle',
        })],
      });

      const result = await service.classify([makeProduct('Kettle')], 'en');
      const warning = result.products[0].notes.find((n) => n.severity === 'warning');
      expect(warning?.messageLocalized).toContain('Electric kettle');
    });
  });

  describe('Дедупликация', () => {
    it('не дублирует TKS-запросы для одинаковых описаний', async () => {
      const { service, tksApi } = createService({
        searchResults: { 'Одинаковый товар': makeSearchResult('5555555555', 'Товар') },
        tnvedCodes: { '5555555555': makeTnvedCode('5555555555') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '5555555555' })],
      });

      const products = [
        makeProduct('Одинаковый товар', { price: 100 }),
        makeProduct('Одинаковый товар', { price: 200 }),
        makeProduct('одинаковый товар', { price: 300 }),
      ];

      const result = await service.classify(products);

      expect(result.products).toHaveLength(3);
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledTimes(1);
      expect(result.products.every((p) => p.tnVedCode === '5555555555')).toBe(true);
    });

    it('различает товары с одинаковым описанием но разным rawContext', async () => {
      const { service, tksApi } = createService({
        searchResults: {
          'Чайник': makeSearchResult('7615109100', 'Чайник алюминиевый'),
        },
        tnvedCodes: {
          '7615109100': makeTnvedCode('7615109100'),
          '7323930000': makeTnvedCode('7323930000'),
        },
        claudeResponse: [
          makeClaudeSelection({ index: 0, tnVedCode: '7615109100', comment: 'Алюминий' }),
          makeClaudeSelection({ index: 1, tnVedCode: '7323930000', comment: 'Нержавейка' }),
        ],
      });

      const products = [
        makeProduct('Чайник', { rawContext: 'алюминий' }),
        makeProduct('Чайник', { rawContext: 'нержавеющая сталь' }),
      ];

      const result = await service.classify(products);

      // Two unique products despite same description
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledTimes(2);
      expect(result.products).toHaveLength(2);
    });
  });

  describe('Кэш классификаций', () => {
    it('не вызывает Claude classification повторно для закэшированного описания', async () => {
      const { service, anthropic } = createService({
        searchResults: { 'Кэшируемый товар': makeSearchResult('6666666666', 'Товар') },
        tnvedCodes: { '6666666666': makeTnvedCode('6666666666') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '6666666666' })],
      });

      await service.classify([makeProduct('Кэшируемый товар')]);
      expect(classificationCallCount(anthropic!)).toBe(1);

      const result = await service.classify([makeProduct('Кэшируемый товар')]);
      // Classification is cached, no second call
      expect(classificationCallCount(anthropic!)).toBe(1);
      expect(result.products[0].tnVedCode).toBe('6666666666');
    });
  });

  describe('Ставки из TKS', () => {
    it('извлекает IMP, NDS, AKC, IMP2, IMPEDI2, IMPSIGN', async () => {
      const { service } = createService({
        searchResults: { 'Ковёр': makeSearchResult('5701100000', 'Ковры') },
        tnvedCodes: {
          '5701100000': makeTnvedCode('5701100000', {
            IMP: 10,
            IMPSIGN: '>',
            IMP2: 0.38,
            IMPEDI2: '055',
            NDS: 20,
            AKC: 5,
          }),
        },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '5701100000', comment: 'Ковёр' })],
      });

      const result = await service.classify([makeProduct('Ковёр')]);
      const p = result.products[0];
      expect(p.dutyRate).toBe(10);
      expect(p.dutySign).toBe('>');
      expect(p.dutyMin).toBe(0.38);
      expect(p.dutyMinUnit).toBe('EUR/м²');
      expect(p.vatRate).toBe(20);
      expect(p.exciseRate).toBe(5);
    });
  });

  describe('Fallback на лучший TKS-кандидат без Claude', () => {
    it('использует top TKS кандидата когда Claude вернул null', async () => {
      const { service } = createService({
        searchResults: {
          'Товар': {
            data: [
              { CODE: '7777777777', KR_NAIM: 'Лучший кандидат', CNT: 80 },
              { CODE: '8888888888', KR_NAIM: 'Другой', CNT: 20 },
            ],
            hm: 100,
          },
        },
        tnvedCodes: { '7777777777': makeTnvedCode('7777777777') },
        claudeResponse: [],
      });

      const result = await service.classify([makeProduct('Товар')]);
      expect(result.products[0].tnVedCode).toBe('7777777777');
      expect(result.products[0].verified).toBe(false);
    });
  });

  describe('Формулирование поисковых запросов', () => {
    it('использует Haiku для формулирования нескольких коротких запросов', async () => {
      const { service, tksApi } = createService({
        searchResults: {
          'ИГРУШКА МУЗЫКАЛЬНАЯ': makeSearchResult('9503005500', 'Игрушки', 60, 100),
          'ИГРУШКА ПЛАСТМАССА': makeSearchResult('9503005500', 'Игрушки', 40, 80),
        },
        tnvedCodes: { '9503005500': makeTnvedCode('9503005500') },
        queryFormulationResults: [{ index: 0, queries: ['ИГРУШКА МУЗЫКАЛЬНАЯ', 'ИГРУШКА ПЛАСТМАССА', 'ИГРУШКА ДЕТСКАЯ', 'ИГРУШКА ЗВУКОВАЯ', 'ИЗДЕЛИЕ ПЛАСТМАССА'] }],
        claudeResponse: [makeClaudeSelection({ tnVedCode: '9503005500', comment: 'Игрушка' })],
      });

      const result = await service.classify([
        makeProduct('Музыкальная игрушка', { rawContext: 'АБС-пластик; батарейка' }),
      ]);

      // TKS searched with all 5 formulated queries
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledTimes(5);
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledWith('ИГРУШКА МУЗЫКАЛЬНАЯ');
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledWith('ИГРУШКА ПЛАСТМАССА');
      expect(result.products[0].tnVedCode).toBe('9503005500');
    });

    it('объединяет кандидатов из разных запросов, дедуплицируя по коду', async () => {
      const { service, anthropic } = createService({
        searchResults: {
          'ЧАЙНИК ЭЛЕКТРИЧЕСКИЙ': {
            data: [
              { CODE: '8516101000', KR_NAIM: 'Чайники электрические', CNT: 60 },
              { CODE: '8516790000', KR_NAIM: 'Другое', CNT: 20 },
            ],
            hm: 100,
          },
          'ЧАЙНИК СТАЛЬ': {
            data: [
              { CODE: '8516101000', KR_NAIM: 'Чайники электрические', CNT: 50 },
              { CODE: '7323930000', KR_NAIM: 'Посуда из нерж. стали', CNT: 30 },
            ],
            hm: 100,
          },
        },
        tnvedCodes: {
          '8516101000': makeTnvedCode('8516101000'),
        },
        queryFormulationResults: [{ index: 0, queries: ['ЧАЙНИК ЭЛЕКТРИЧЕСКИЙ', 'ЧАЙНИК СТАЛЬ'] }],
        claudeResponse: [makeClaudeSelection({ tnVedCode: '8516101000', comment: 'Чайник' })],
      });

      await service.classify([makeProduct('Чайник электрический', { rawContext: 'нержавеющая сталь' })]);

      // Verify candidates passed to Claude are deduplicated (3 unique codes, not 4)
      const classifyCall = anthropic!.messages.create.mock.calls.find(
        (call: any[]) => call[0]?.tools?.[0]?.name === 'classify_products',
      );
      const userPrompt: string = classifyCall?.[0]?.messages?.[0]?.content ?? '';
      const parsed = JSON.parse(userPrompt.replace(/^Классифицируй товары по ТН ВЭД:\s*/, ''));
      const candidates: Array<{ code: string }> = parsed[0].candidates;
      const codes = candidates.map((c) => c.code);
      // 8516101000 appears once (deduped), plus 8516790000 and 7323930000
      expect(codes.filter((c) => c === '8516101000')).toHaveLength(1);
      expect(codes).toContain('8516790000');
      expect(codes).toContain('7323930000');
      // Deduped 8516101000 keeps highest confidence (60/100=0.6 > 50/100=0.5)
      const topCandidate = candidates.find((c) => c.code === '8516101000') as any;
      expect(topCandidate.confidence).toBe(0.6);
    });

    it('fallback на raw description при ошибке Haiku', async () => {
      const { service, tksApi } = createService({
        searchResults: { 'Чайник': makeSearchResult('8516101000', 'Чайники') },
        tnvedCodes: { '8516101000': makeTnvedCode('8516101000') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '8516101000' })],
      });

      // Override to make formulation fail
      const anthropic = (service as any).anthropic;
      const originalCreate = anthropic.messages.create;
      anthropic.messages.create = jest.fn().mockImplementation((params: any) => {
        if (params.tools?.[0]?.name === 'formulate_search_queries') {
          return Promise.reject(new Error('Haiku timeout'));
        }
        return originalCreate(params);
      });

      const result = await service.classify([makeProduct('Чайник')]);
      expect(tksApi.searchGoodsGrouped).toHaveBeenCalledWith('Чайник');
      expect(result.products[0].matched).toBe(true);
    });
  });

  describe('Валидация HS-кодов из файла', () => {
    it('валидирует author-provided hsCode через getTnvedCode', async () => {
      const { service, tksApi } = createService({
        searchResults: { 'Игрушка': makeSearchResult('9503005500', 'Игрушки') },
        tnvedCodes: { '9503005500': makeTnvedCode('9503005500') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '9503005500', confidence: 0.95, fromCandidates: false })],
      });

      const result = await service.classify([
        makeProduct('Игрушка', { hsCode: '9503005500' }),
      ]);

      // getTnvedCode called for validation + rate loading
      expect(tksApi.getTnvedCode).toHaveBeenCalledWith('9503005500');
      expect(result.products[0].tnVedCode).toBe('9503005500');
    });

    it('передаёт hsCode и rawContext в Claude для классификации', async () => {
      const { service, anthropic } = createService({
        searchResults: { 'Игрушка': makeSearchResult('9503005500', 'Игрушки') },
        tnvedCodes: { '9503005500': makeTnvedCode('9503005500') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '9503005500', fromCandidates: false })],
      });

      await service.classify([
        makeProduct('Игрушка', { hsCode: '9503005500', rawContext: 'АБС-пластик; батарейка' }),
      ]);

      // Find the classification call (not query formulation)
      const classifyCall = anthropic!.messages.create.mock.calls.find(
        (call: any[]) => call[0]?.tools?.[0]?.name === 'classify_products',
      );
      const userPrompt = classifyCall?.[0]?.messages?.[0]?.content ?? '';
      expect(userPrompt).toContain('9503005500');
      expect(userPrompt).toContain('АБС-пластик');
      expect(userPrompt).toContain('hsCodeValid');
    });

    it('игнорирует hsCode короче 10 цифр', async () => {
      const { service, tksApi } = createService({
        searchResults: { 'Товар': makeSearchResult('1111111111', 'Товар') },
        tnvedCodes: { '1111111111': makeTnvedCode('1111111111') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '1111111111' })],
      });

      await service.classify([makeProduct('Товар', { hsCode: '123456' })]);

      // 6-digit code not validated (needs 10 digits)
      const tnvedCalls = tksApi.getTnvedCode.mock.calls.filter(
        (call: any[]) => call[0] === '123456',
      );
      expect(tnvedCalls).toHaveLength(0);
    });
  });
});
