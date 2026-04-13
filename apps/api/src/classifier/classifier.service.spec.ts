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
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'toolu_mock', name: 'classify_products', input: { items: opts.claudeResponse ?? [] } }],
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }),
        },
      }
    : null;

  const aiConfig = {
    getClassifierModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
  };

  const service = new ClassifierService(tksApi as any, anthropic as any, aiConfig as any);
  return { service, tksApi, anthropic, aiConfig };
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
    it('добавляет warning при низкой уверенности (< 0.7)', async () => {
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
  });

  describe('Кэш классификаций', () => {
    it('не вызывает Claude повторно для закэшированного описания', async () => {
      const { service, anthropic } = createService({
        searchResults: { 'Кэшируемый товар': makeSearchResult('6666666666', 'Товар') },
        tnvedCodes: { '6666666666': makeTnvedCode('6666666666') },
        claudeResponse: [makeClaudeSelection({ tnVedCode: '6666666666' })],
      });

      await service.classify([makeProduct('Кэшируемый товар')]);
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(1);

      const result = await service.classify([makeProduct('Кэшируемый товар')]);
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(1);
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
});
