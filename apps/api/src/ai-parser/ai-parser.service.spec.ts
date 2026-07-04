import { BadRequestException } from '@nestjs/common';
import { AiParserService } from './ai-parser.service';

/** Sentinel: на этом месте последовательности create() отклоняется с ошибкой API. */
const CLAUDE_CALL_FAILS = { __reject: true } as const;

function createMockClaude(responses: unknown[]) {
  let callIdx = 0;
  return {
    messages: {
      create: jest.fn().mockImplementation(() => {
        const resp = responses[callIdx] ?? responses[responses.length - 1];
        callIdx++;
        if (resp && (resp as { __reject?: boolean }).__reject) {
          return Promise.reject(new Error('mock Claude API error'));
        }
        return Promise.resolve({
          content: [{ type: 'tool_use', id: 'toolu_mock', name: 'mock_tool', input: resp }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        });
      }),
    },
  };
}

function createService(opts: {
  claudeResponses?: unknown[];
  spreadsheetData?: {
    rows: string[][];
    columnCount: number;
    images?: unknown[];
    sheetName?: string;
    skippedSheets?: { name: string; rows: number }[];
  };
  claudeEnabled?: boolean;
} = {}) {
  const claudeEnabled = opts.claudeEnabled ?? true;
  const spreadsheetData = opts.spreadsheetData
    ? { ...opts.spreadsheetData, images: opts.spreadsheetData.images ?? [] }
    : { rows: [], columnCount: 0, images: [] };

  const anthropic = claudeEnabled ? createMockClaude(opts.claudeResponses ?? []) : null;

  const spreadsheetReader = {
    read: jest.fn().mockResolvedValue(spreadsheetData),
  };

  const aiConfig = {
    getParserModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
  };

  const audit = {
    trackAiCall: jest
      .fn()
      .mockImplementation(async (_params: unknown, fn: () => Promise<unknown>) => fn()),
    recordAiCall: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AiParserService(
    anthropic as any,
    spreadsheetReader as any,
    aiConfig as any,
    audit as any,
  );
  return { service, anthropic, spreadsheetReader, audit };
}

/** Стандартные 5 строк данных (header + 4 товара) */
function makeSpreadsheetData(
  productCount = 4,
): { rows: string[][]; columnCount: number; images: never[] } {
  const header = ['Наименование', 'Цена', 'Вес', 'Количество'];
  const rows = [header];
  for (let i = 0; i < productCount; i++) {
    rows.push([`Товар ${i + 1}`, String((i + 1) * 100), String(i + 1), '10']);
  }
  return { rows, columnCount: 4, images: [] };
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

/** Ответ, который analyzeStructure отклонит → fallback на парсинг без структуры */
const STRUCTURE_FALLBACK = {};

/** Ответ Claude при валидации — ok */
const VALIDATION_OK = { valid: true, issues: [] };
const VALIDATION_FAIL = { valid: false, issues: ['Некорректный перевод'] };

describe('AiParserService', () => {
  describe('Базовые проверки входных данных', () => {
    it('выбрасывает ошибку если ANTHROPIC_API_KEY не настроен', async () => {
      const { service } = createService({ claudeEnabled: false });
      await expect(service.parse(Buffer.from(''), 'test.xlsx')).rejects.toThrow(BadRequestException);
    });

    it('rejected если файл слишком большой (>700 строк)', async () => {
      const rows = Array.from({ length: 702 }, (_, i) => [`row ${i}`]);
      const { service } = createService({
        spreadsheetData: { rows, columnCount: 1, images: [] },
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons[0]).toContain('700');
    });

    it('rejected если файл пустой (< 2 строк)', async () => {
      const { service } = createService({
        spreadsheetData: { rows: [['header']], columnCount: 1, images: [] },
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
          STRUCTURE_FALLBACK,          // анализ структуры → fallback
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

    it('пропущенные листы xlsx: ok деградирует до review с предупреждением', async () => {
      const { service } = createService({
        spreadsheetData: {
          ...makeSpreadsheetData(4),
          sheetName: 'Товары',
          skippedSheets: [{ name: 'Лист2', rows: 15 }],
        },
        claudeResponses: [STRUCTURE_FALLBACK, makeClaudeParseResponse(4), VALIDATION_OK],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('review');
      expect(result.rejectionReasons[0]).toContain('обработан только лист «Товары»');
      expect(result.rejectionReasons[0]).toContain('«Лист2» (15 строк)');
    });
  });

  describe('validateSchema: нормализация данных от Claude', () => {
    it('пропускает товары без description', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          STRUCTURE_FALLBACK,
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
          STRUCTURE_FALLBACK,
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

    it('weightGross: сохраняется валидное брутто, отбрасывается брутто меньше нетто', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'USD',
            columnMapping: {},
            products: [
              { description: 'С брутто', price: 100, weight: 1, weightGross: 1.2, quantity: 5 },
              { description: 'Брутто меньше нетто', price: 100, weight: 2, weightGross: 1, quantity: 5 },
              { description: 'Без брутто', price: 100, weight: 1, quantity: 5 },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].weightGross).toBe(1.2);
      expect(result.products[1].weightGross).toBeUndefined();
      expect(result.products[2].weightGross).toBeUndefined();
    });

    it('attributes: известные ключи сохраняются, мусор отбрасывается', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'USD',
            columnMapping: {},
            products: [
              {
                description: 'Ботинки',
                price: 100,
                weight: 1,
                quantity: 5,
                attributes: { material: ' кожа ', brand: 'Acme', bogus: 'x', purpose: '' },
              },
              { description: 'Без атрибутов', price: 100, weight: 1, quantity: 5, attributes: {} },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].attributes).toEqual({ material: 'кожа', brand: 'Acme' });
      expect(result.products[1].attributes).toBeUndefined();
    });

    it('неизвестная валюта → fallback на USD', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
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
          STRUCTURE_FALLBACK, // анализ структуры → fallback
          badResponse,    // attempt 1 → deterministic fail
          goodResponse,   // attempt 2 (retry)
          VALIDATION_OK,  // validation
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // Claude вызван 4 раза: structure + attempt1 + attempt2 + validation
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(4);
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
          STRUCTURE_FALLBACK, // анализ структуры → fallback
          tooFewProducts, // attempt 1 → too few products
          tooFewProducts, // attempt 2 → still too few → assessFeasibility
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // 3 вызова: structure + 2 попытки парсинга (без AI-валидации)
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(3);
      // assessFeasibility — не rejected (1 товар с ценой), но review
      expect(result.feasibility).toBe('review');
    });

    it('построчная сверка с колонкой общей суммы ловит расхождение в любой строке', async () => {
      const spreadsheetData = {
        rows: [
          ['Наименование', 'Цена', 'Вес', 'Кол-во', 'Сумма'],
          ['Товар 1', '100', '1', '10', '1000'], // сходится: 100 × 10 = 1000
          ['Товар 2', '200', '1', '10', '9999'], // НЕ сходится: 200 × 10 = 2000
        ],
        columnCount: 5,
      };
      const structureOk = {
        headerRows: [0],
        dataRows: [1, 2],
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3, totalPrice: 4 },
        currency: 'USD',
        weightNote: 'per_unit',
      };
      const parseResponse = {
        currency: 'USD',
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
        products: [
          { description: 'Товар 1', price: 100, weight: 1, quantity: 10 },
          { description: 'Товар 2', price: 200, weight: 1, quantity: 10 },
        ],
      };

      const { service, anthropic } = createService({
        spreadsheetData,
        claudeResponses: [structureOk, parseResponse, parseResponse],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      // structure + 2 попытки: сверка детерминистическая, AI-валидация не зовётся
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(3);
      expect(result.feasibility).toBe('review');
      const issue = result.rejectionReasons.find((r) => r.includes('Построчная сверка цены'));
      expect(issue).toBeDefined();
      expect(issue).toContain('строка файла 3');
      expect(issue).not.toContain('строка файла 2');
    });

    it('построчная сверка веса принимает совпадение по брутто', async () => {
      const spreadsheetData = {
        rows: [
          ['Наименование', 'Цена', 'Нетто', 'Кол-во', 'Общий вес'],
          ['Товар 1', '100', '1', '10', '12'], // нетто×кол-во=10 ≠ 12, но брутто 1.2×10 = 12
        ],
        columnCount: 5,
      };
      const structureOk = {
        headerRows: [0],
        dataRows: [1],
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3, totalWeight: 4 },
        currency: 'USD',
        weightNote: 'per_unit',
      };
      const parseResponse = {
        currency: 'USD',
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
        products: [
          { description: 'Товар 1', price: 100, weight: 1, weightGross: 1.2, quantity: 10 },
        ],
      };

      const { service } = createService({
        spreadsheetData,
        claudeResponses: [structureOk, parseResponse, VALIDATION_OK],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('ok');
    });
  });

  describe('Chunked-парсинг: повтор упавших блоков', () => {
    /** header + 150 товарных строк → chunk0 (100) + chunk1 (50). */
    function makeChunkedFixture() {
      const rows: string[][] = [
        ['Наименование', 'Цена', 'Вес', 'Кол-во'],
        ...Array.from({ length: 150 }, (_, i) => [`Товар ${i + 1}`, '100', '1', '10']),
      ];
      const structure = {
        headerRows: [0],
        dataRows: Array.from({ length: 150 }, (_, i) => i + 1),
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
        currency: 'USD',
        weightNote: 'per_unit',
      };
      const makeProducts = (from: number, count: number) => ({
        currency: 'USD',
        columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
        products: Array.from({ length: count }, (_, i) => ({
          description: `Товар ${from + i + 1}`,
          price: 100,
          weight: 1,
          quantity: 10,
        })),
      });
      return { spreadsheetData: { rows, columnCount: 4 }, structure, makeProducts };
    }

    it('упавший chunk повторяется и результат остаётся полным', async () => {
      const { spreadsheetData, structure, makeProducts } = makeChunkedFixture();
      const { service, anthropic } = createService({
        spreadsheetData,
        claudeResponses: [
          structure,
          makeProducts(0, 100), // chunk 0
          CLAUDE_CALL_FAILS, // chunk 1: первый проход падает
          makeProducts(100, 50), // chunk 1: повторная попытка
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(anthropic!.messages.create).toHaveBeenCalledTimes(5);
      expect(result.feasibility).toBe('ok');
      expect(result.products).toHaveLength(150);
      expect(result.effectiveDataRows).toBeUndefined();
    });

    it('chunk упал дважды: review с диапазоном потерянных строк и effectiveDataRows', async () => {
      const { spreadsheetData, structure, makeProducts } = makeChunkedFixture();
      const { service } = createService({
        spreadsheetData,
        claudeResponses: [
          structure,
          makeProducts(0, 100), // chunk 0
          CLAUDE_CALL_FAILS, // chunk 1: первый проход
          CLAUDE_CALL_FAILS, // chunk 1: повтор тоже падает
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('review');
      expect(result.products).toHaveLength(100);
      const lost = result.rejectionReasons.find((r) => r.includes('потеряны'));
      expect(lost).toBeDefined();
      // dataRows[100..149] = строки файла 101..150 (0-based) → 102–151 в 1-based нумерации
      expect(lost).toContain('строки файла 102–151');
      // Строки, реально попавшие в products, — для корректной привязки фото
      expect(result.effectiveDataRows).toHaveLength(100);
    });
  });

  describe('assessFeasibility: оценка пригодности', () => {
    it('rejected если 0 товаров', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(3),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          { currency: 'USD', columnMapping: {}, products: [] },
          { currency: 'USD', columnMapping: {}, products: [] },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(result.rejectionReasons[0]).toContain('товарной строки');
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
          STRUCTURE_FALLBACK,
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
          STRUCTURE_FALLBACK,
          { currency: 'USD', columnMapping: {}, products },
          { currency: 'USD', columnMapping: {}, products },
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.feasibility).toBe('rejected');
      expect(
        result.rejectionReasons.some((r) =>
          r.toLowerCase().includes('наименование') || r.toLowerCase().includes('название'),
        ),
      ).toBe(true);
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
          STRUCTURE_FALLBACK,
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
          STRUCTURE_FALLBACK, // анализ структуры → fallback
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

  describe('hsCode и rawContext', () => {
    it('извлекает hsCode из ответа Claude', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'CNY',
            columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
            products: [
              { description: 'Игрушка', price: 100, weight: 1, quantity: 10, hsCode: '9503005500' },
              { description: 'Чайник', price: 200, weight: 2, quantity: 5 },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].hsCode).toBe('9503005500');
      expect(result.products[1].hsCode).toBeUndefined();
    });

    it('собирает rawContext из колонок вне columnMapping при наличии structure', async () => {
      const header = ['Наименование', 'Цена', 'Вес', 'Количество', 'Материал', 'Артикул'];
      const data = {
        rows: [
          header,
          ['Игрушка', '100', '1', '10', 'АБС-пластик', 'ART-1'],
          ['Чайник', '200', '2', '5', 'нержавеющая сталь', 'ART-2'],
        ],
        columnCount: 6,
        images: [],
      };
      const { service } = createService({
        spreadsheetData: data,
        claudeResponses: [
          {
            headerRows: [0],
            dataRows: [1, 2],
            columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
            currency: 'CNY',
            weightNote: 'per_unit',
          },
          {
            currency: 'CNY',
            columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
            products: [
              { description: 'Игрушка', price: 100, weight: 1, quantity: 10 },
              { description: 'Чайник', price: 200, weight: 2, quantity: 5 },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].rawContext).toBe('Материал=АБС-пластик; Артикул=ART-1');
      expect(result.products[1].rawContext).toBe('Материал=нержавеющая сталь; Артикул=ART-2');
    });

    it('склеивает имена колонок из двух строк заголовков (китайский + русский)', async () => {
      const data = {
        rows: [
          ['品名', '单价', '单重', '数量', '材质', '货号'],
          ['Наименование', 'Цена', 'Вес', 'Количество', 'Материал', 'Артикул'],
          ['手提篮', '3.6', '17.6', '3200', '塑料', 'SL-50504-269'],
        ],
        columnCount: 6,
        images: [],
      };
      const { service } = createService({
        spreadsheetData: data,
        claudeResponses: [
          {
            headerRows: [0, 1],
            dataRows: [2],
            columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
            currency: 'CNY',
            weightNote: 'per_unit',
          },
          {
            currency: 'CNY',
            columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
            products: [
              { description: 'Корзина', price: 3.6, weight: 17.6, quantity: 3200 },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].rawContext).toBe(
        '材质 / Материал=塑料; 货号 / Артикул=SL-50504-269',
      );
    });

    it('нормализует hsCode — убирает не-цифры', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'CNY',
            columnMapping: {},
            products: [
              { description: 'Товар', price: 100, weight: 1, quantity: 10, hsCode: '9503.00.55.00' },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].hsCode).toBe('9503005500');
    });

    it('отбрасывает hsCode короче 6 цифр', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'CNY',
            columnMapping: {},
            products: [
              { description: 'Товар', price: 100, weight: 1, quantity: 10, hsCode: '9503' },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].hsCode).toBeUndefined();
    });

    it('пропускает пустой rawContext', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(2),
        claudeResponses: [
          STRUCTURE_FALLBACK,
          {
            currency: 'CNY',
            columnMapping: {},
            products: [
              { description: 'Товар', price: 100, weight: 1, quantity: 10, rawContext: '  ' },
            ],
          },
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.products[0].rawContext).toBeUndefined();
    });
  });

  describe('analyzeStructure: распознавание страны происхождения', () => {
    const suggestion = {
      code: '156',
      source: 'ai_currency',
      reason: 'Цены в юанях (￥) и китайские заголовки',
    };
    const structureFields = {
      headerRows: [0],
      dataRows: [1, 2, 3, 4],
      columnMapping: { description: 0, price: 1, weight: 2, quantity: 3 },
      currency: 'CNY',
      weightNote: 'per_unit',
      countrySuggestion: suggestion,
    };

    it('countrySuggestion сохраняется когда поля на верхнем уровне', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [structureFields, makeClaudeParseResponse(4), VALIDATION_OK],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.countrySuggestion).toEqual(suggestion);
    });

    it('countrySuggestion сохраняется когда Opus оборачивает ответ в { structure: { ... } }', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [
          { structure: structureFields },
          makeClaudeParseResponse(4),
          VALIDATION_OK,
        ],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.countrySuggestion).toEqual(suggestion);
    });
  });

  describe('Token usage', () => {
    it('накапливает tokenUsage из всех вызовов Claude', async () => {
      const { service } = createService({
        spreadsheetData: makeSpreadsheetData(4),
        claudeResponses: [STRUCTURE_FALLBACK, makeClaudeParseResponse(4), VALIDATION_OK],
      });

      const result = await service.parse(Buffer.from(''), 'test.xlsx');
      expect(result.tokenUsage).toBeDefined();
      // 3 вызова Claude (structure + parse + validate) × 100 input tokens
      const totalInput = Object.values(result.tokenUsage).reduce(
        (sum, usage) => sum + usage.inputTokens,
        0,
      );
      expect(totalInput).toBe(300);
    });
  });
});
