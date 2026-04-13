import { BadRequestException } from '@nestjs/common';
import { AiParserService } from './ai-parser.service';

function createMockClaude(responses: unknown[]) {
  let callIdx = 0;
  return {
    messages: {
      create: jest.fn().mockImplementation(() => {
        const resp = responses[callIdx] ?? responses[responses.length - 1];
        callIdx++;
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(resp) }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        });
      }),
    },
  };
}

function createService(opts: {
  claudeResponses?: unknown[];
  spreadsheetData?: { rows: string[][]; columnCount: number };
  claudeEnabled?: boolean;
} = {}) {
  const claudeEnabled = opts.claudeEnabled ?? true;
  const spreadsheetData = opts.spreadsheetData ?? { rows: [], columnCount: 0 };

  const anthropic = claudeEnabled ? createMockClaude(opts.claudeResponses ?? []) : null;

  const spreadsheetReader = {
    read: jest.fn().mockResolvedValue(spreadsheetData),
  };

  const aiConfig = {
    getParserModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
  };

  const service = new AiParserService(anthropic as any, spreadsheetReader as any, aiConfig as any);
  return { service, anthropic, spreadsheetReader };
}

/** Стандартные 5 строк данных (header + 4 товара) */
function makeSpreadsheetData(productCount = 4): { rows: string[][]; columnCount: number } {
  const header = ['Наименование', 'Цена', 'Вес', 'Количество'];
  const rows = [header];
  for (let i = 0; i < productCount; i++) {
    rows.push([`Товар ${i + 1}`, String((i + 1) * 100), String(i + 1), '10']);
  }
  return { rows, columnCount: 4 };
}

/** Ответ Claude — валидный результат парсинга */
function makeClaudeParseResponse(productCount = 4) {
  const products = [];
  for (let i = 0; i < productCount; i++) {
    products.push({
      description: `Товар ${i + 1}`,
      price: (i + 1) * 100,
      weight: i + 1,
      quantity: 10,
    });
  }
  return {
    currency: 'CNY',
    columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
    products,
  };
}

/** Ответ Claude при валидации — ok */
const VALIDATION_OK = { valid: true, issues: [] };
const VALIDATION_FAIL = { valid: false, issues: ['Некорректный перевод'] };

describe('AiParserService', () => {
  describe('Базовые проверки входных данных', () => {
    it('выбрасывает ошибку если ANTHROPIC_API_KEY не настроен', async () => {
      const { service } = createService({ claudeEnabled: false });
      await expect(service.parse(Buffer.from(''), 'test.xlsx')).rejects.toThrow(BadRequestException);
    });

    it('rejected если файл слишком большой (>400 строк)', async () => {
      const rows = Array.from({ length: 402 }, (_, i) => [`row ${i}`]);
      const { service } = createService({
        spreadsheetData: { rows, columnCount: 1 },
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons[0]).toContain('400');
    });

    it('rejected если файл пустой (< 2 строк)', async () => {
      const { service } = createService({
        spreadsheetData: { rows: [['header']], columnCount: 1 },
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons[0]).toContain('пуст');
    });
  });

  describe('Успешный парсинг (single pass)', () => {
    it('возвращает ok при валидном ответе Claude + прохождении валидации', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [
          makeClaudeParseResponse(4), // основной парсинг
          VALIDATION_OK,               // AI-валидация
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('ok');
      expect(result.products).toHaveLength(4);
      expect(result.currency).toBe('CNY');
      expect(result.rejectionReasons).toHaveLength(0);
    });
  });

  describe('validateSchema: нормализация данных от Claude', () => {
    it('пропускает товары без description', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          {
            currency: 'USD',
            columnMapping: {},
            products: [
              { description: 'Нормальный товар', price: 100, weight: 1, quantity: 5 },
              { description: '', price: 200, weight: 2, quantity: 10 }, // пустой → пропустит
              { description: '  ', price: 300, weight: 3, quantity: 15 }, // пробелы → пропустит
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products).toHaveLength(1);
      expect(result.products[0].description).toBe('Нормальный товар');
    });

    it('нормализует: price≥0, weight≥0, quantity≥1', async () => {
      const badProducts = {
        currency: 'USD',
        columnMapping: {},
        products: [
          { description: 'Нормальный', price: 100, weight: 1, quantity: 10 },
          { description: 'Плохой', price: -5, weight: -1, quantity: 0 },
        ],
      };
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          badProducts, // attempt 1: zero price → deterministic fail
          badProducts, // attempt 2: retry → same → assessFeasibility
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // Rejected из-за нулевой цены, но нормализация применяется
      const bad = result.products.find((p) => p.description === 'Плохой')!;
      expect(bad.price).toBe(0);
      expect(bad.weight).toBe(0);
      expect(bad.quantity).toBe(1);
    });

    it('неизвестная валюта → fallback на USD', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          {
            currency: 'XYZ',
            columnMapping: {},
            products: [{ description: 'Товар', price: 100, weight: 1, quantity: 10 }],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.currency).toBe('USD');
    });
  });

  describe('checkDeterministic: детерминистическая валидация', () => {
    it('retry при наличии нулевых цен', async () => {
      const data = makeSpreadsheetData(4);
      const badResponse = {
        currency: 'CNY',
        columnMapping: {},
        products: [
          { description: 'Товар 1', price: 0, weight: 1, quantity: 10 },
          { description: 'Товар 2', price: 0, weight: 1, quantity: 10 },
          { description: 'Товар 3', price: 0, weight: 1, quantity: 10 },
          { description: 'Товар 4', price: 100, weight: 1, quantity: 10 },
        ],
      };
      const goodResponse = makeClaudeParseResponse(4);

      const { service, anthropic } = createService({
        spreadsheetData: data,
        claudeResponses: [
          badResponse,    // attempt 1 → deterministic fail
          goodResponse,   // attempt 2 (retry)
          VALIDATION_OK,  // validation
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // Claude вызван 3 раза: attempt1 + attempt2 + validation
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(3);
      expect(result.products).toHaveLength(4);
    });

    it('retry при слишком малом количестве товаров vs строк', async () => {
      const data = makeSpreadsheetData(20); // 21 строка (header + 20)
      const tooFewProducts = {
        currency: 'CNY',
        columnMapping: {},
        products: [{ description: 'Единственный', price: 100, weight: 1, quantity: 10 }],
      };

      const { service, anthropic } = createService({
        spreadsheetData: data,
        claudeResponses: [
          tooFewProducts, // attempt 1 → too few products
          tooFewProducts, // attempt 2 → still too few → assessFeasibility
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // 2 попытки парсинга (без AI-валидации — deterministic issues на обоих)
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(2);
      // assessFeasibility — не rejected (1 товар с ценой), но review
      expect(result.feasibility).toBe('review');
    });
  });

  describe('assessFeasibility: оценка пригодности', () => {
    it('rejected если 0 товаров', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          { currency: 'USD', columnMapping: {}, products: [] },
          { currency: 'USD', columnMapping: {}, products: [] },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons[0]).toContain('ни одного товара');
    });

    it('rejected если есть нулевые цены', async () => {
      const products = Array.from({ length: 10 }, (_, i) => ({
        description: `Товар ${i}`,
        price: i < 9 ? 0 : 100, // 90% нулевых
        weight: 1,
        quantity: 10,
      }));

      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(10),
        claudeResponses: [
          { currency: 'USD', columnMapping: {}, products },
          { currency: 'USD', columnMapping: {}, products },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons.some((r) => r.includes('цен'))).toBe(true);
    });

    it('rejected если есть пустые описания', async () => {
      const products = Array.from({ length: 10 }, (_, i) => ({
        description: i < 9 ? 'ab' : 'Нормальный товар', // 90% коротких (<3)
        price: 100,
        weight: 1,
        quantity: 10,
      }));

      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(10),
        claudeResponses: [
          { currency: 'USD', columnMapping: {}, products },
          { currency: 'USD', columnMapping: {}, products },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons.some((r) => r.includes('описания') || r.includes('Описания'))).toBe(true);
    });

    it('rejected если есть товары с нулевым весом', async () => {
      const products = Array.from({ length: 5 }, (_, i) => ({
        description: `Товар ${i + 1}`,
        price: 100,
        weight: 0,
        quantity: 10,
      }));

      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(5),
        claudeResponses: [
          { currency: 'USD', columnMapping: {}, products },
          { currency: 'USD', columnMapping: {}, products },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons.some((r) => r.includes('вес'))).toBe(true);
    });

    it('review (не rejected) при AI-валидации с issues', async () => {
      const parseResp = makeClaudeParseResponse(4);
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [
          parseResp,       // attempt 1: parse
          VALIDATION_FAIL, // attempt 1: AI-validation → fail
          parseResp,       // attempt 2: retry parse
          VALIDATION_FAIL, // attempt 2: AI-validation → fail again
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // Данные нормальные, но AI-валидация не прошла → review
      expect(result.feasibility).toBe('review');
      expect(result.rejectionReasons).toContain('Некорректный перевод');
    });
  });

  describe('Token usage', () => {
    it('накапливает tokenUsage из всех вызовов Claude', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [makeClaudeParseResponse(4), VALIDATION_OK],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.tokenUsage).toBeDefined();
      // 2 вызова Claude (parse + validate) × 100 input tokens
      const totalInput = Object.values(result.tokenUsage).reduce(
        (sum, usage) => sum + usage.inputTokens,
        0,
      );
      expect(totalInput).toBe(200);
    });
  });
});
