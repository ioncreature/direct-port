import type { TnvedCode, TnvedallEntry } from '@direct-port/tks-api';
import type { VerifiedProduct } from '../classifier/classifier.service';
import { DutyInterpreterService } from './duty-interpreter.service';
import type { DutyInterpretation } from './interfaces';

function makeTnvedCode(
  code: string,
  rates: Partial<TnvedCode['TNVED']> = {},
  tnvedall?: TnvedCode['TNVEDALL'],
): TnvedCode {
  return {
    CODE: code,
    KR_NAIM: `Описание ${code}`,
    TNVED: {
      IMP: 10,
      IMPEDI: '1',
      IMPSIGN: null,
      IMP2: null,
      IMPEDI2: null,
      NDS: 20,
      AKC: 0,
      ...rates,
    } as any,
    ...(tnvedall ? { TNVEDALL: tnvedall } : {}),
  };
}

function makeProduct(overrides: Partial<VerifiedProduct> = {}): VerifiedProduct {
  return {
    description: 'Товар',
    quantity: 1,
    price: 100,
    weight: 1,
    tnVedCode: '0000000000',
    tnVedDescription: 'desc',
    dutyRate: 10,
    dutyRateUnit: '%',
    dutySign: null,
    dutyMin: null,
    dutyMinUnit: null,
    vatRate: 20,
    exciseRate: 0,
    matchConfidence: 0.9,
    matched: true,
    verified: true,
    suggestedCode: null,
    verificationComment: '',
    notes: [],
    tnvedRaw: makeTnvedCode('0000000000'),
    ...overrides,
  };
}

function makeInterpretation(
  code: string,
  overrides: Partial<DutyInterpretation> = {},
): DutyInterpretation {
  return {
    tnvedCode: code,
    charges: [
      {
        type: 'import_duty',
        label: 'Ввозная пошлина',
        method: { kind: 'ad_valorem', rate: 10 },
        base: 'customs_value',
      },
    ],
    reasoning: 'Адвалорная ставка 10%',
    ...overrides,
  };
}

interface ServiceOpts {
  items?: DutyInterpretation[];
  itemsByCall?: DutyInterpretation[][];
  claudeEnabled?: boolean;
  claudeError?: Error;
  tnvedByCode?: Record<string, TnvedCode>;
  tksFetchError?: Error;
}

function createService(opts: ServiceOpts = {}) {
  const messagesCreate = jest.fn();
  let callIdx = 0;

  messagesCreate.mockImplementation(() => {
    if (opts.claudeError) return Promise.reject(opts.claudeError);
    const items = opts.itemsByCall?.[callIdx++] ?? opts.items ?? [];
    return Promise.resolve({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'interpret_duties', input: { items } }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  });

  const anthropic =
    opts.claudeEnabled === false ? null : { messages: { create: messagesCreate } };

  const getTnvedCode = jest.fn().mockImplementation((code: string) => {
    if (opts.tksFetchError) return Promise.reject(opts.tksFetchError);
    const found = opts.tnvedByCode?.[code];
    if (!found) return Promise.reject(new Error(`TNVED ${code} not found`));
    return Promise.resolve(found);
  });
  const tksApi = { getTnvedCode };

  const aiConfig = {
    getInterpreterModel: jest.fn().mockResolvedValue('claude-opus-4-7'),
  };

  const audit = {
    trackAiCall: jest
      .fn()
      .mockImplementation(async (_params: unknown, fn: () => Promise<unknown>) => fn()),
    recordAiCall: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DutyInterpreterService(
    anthropic as any,
    tksApi as any,
    aiConfig as any,
    audit as any,
  );
  return { service, messagesCreate, getTnvedCode, aiConfig, audit };
}

describe('DutyInterpreterService', () => {
  describe('без Claude (anthropic=null)', () => {
    it('возвращает продукты с dutyInterpretation=null без warning для адвалорных ставок', async () => {
      const { service, getTnvedCode } = createService({ claudeEnabled: false });
      const product = makeProduct(); // только ad_valorem

      const { products } = await service.interpret([product]);

      expect(products).toHaveLength(1);
      expect(products[0].dutyInterpretation).toBeNull();
      expect(products[0].notes).toEqual([]);
      expect(getTnvedCode).not.toHaveBeenCalled();
    });

    it('добавляет warning note когда есть комбинированная ставка (IMPSIGN)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnvedRaw: makeTnvedCode('1234567890', { IMPSIGN: '>', IMP2: 0.5, IMPEDI2: '166' }),
      });

      const { products } = await service.interpret([product]);

      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
      expect(products[0].notes[0].stage).toBe('interpret');
      expect(products[0].notes[0].field).toBe('duty');
    });

    it('добавляет warning note когда есть акциз', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnvedRaw: makeTnvedCode('1234567890', { AKC: 12 }),
      });

      const { products } = await service.interpret([product]);

      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
    });

    it('добавляет warning note для flat-currency ставки (dutyRateUnit=EUR без знаменателя)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({ dutyRateUnit: 'EUR', tnvedRaw: undefined });

      const { products } = await service.interpret([product]);

      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
    });

    it('добавляет warning note если есть TNVEDALL[19] (антидемпинг по стране)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnVedCode: '8708705009',
        tnvedRaw: makeTnvedCode('8708705009', {}, {
          '19': [{ CU: '156', MIN: 33.69, PRIZNAK: 19 } as TnvedallEntry],
        }),
      });

      const { products } = await service.interpret([product]);

      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
      expect(products[0].notes[0].stage).toBe('interpret');
    });

    it('добавляет warning note если есть TNVEDALL[30] (страновая льгота)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnVedCode: '1234567890',
        tnvedRaw: makeTnvedCode('1234567890', {}, {
          '30': [{ CU: '704', MIN: 0, PRIZNAK: 30 } as TnvedallEntry],
        }),
      });

      const { products } = await service.interpret([product]);

      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
    });

    it('локализует warning message при language!=ru', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnvedRaw: makeTnvedCode('1234567890', { AKC: 5 }),
      });

      const { products } = await service.interpret([product], 'en');

      expect(products[0].notes[0].messageLocalized).toBeDefined();
      expect(typeof products[0].notes[0].messageLocalized).toBe('string');
    });
  });

  describe('интерпретация через Claude', () => {
    it('передаёт результат Claude в dutyInterpretation продукта', async () => {
      const interp = makeInterpretation('1234567890', {
        charges: [
          {
            type: 'import_duty',
            label: 'Ввозная',
            method: { kind: 'combined_min', rate: 15, specificAmount: 0.5, unit: 'EUR', per: 'kg' },
            base: 'customs_value',
          },
        ],
        reasoning: 'Комбинированная: 15% но не менее 0.5 EUR/кг',
      });
      const { service, messagesCreate } = createService({ items: [interp] });
      const product = makeProduct({ tnVedCode: '1234567890' });

      const { products } = await service.interpret([product]);

      expect(messagesCreate).toHaveBeenCalledTimes(1);
      expect(products[0].dutyInterpretation).toEqual(interp);
      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('info');
      expect(products[0].notes[0].message).toContain('Комбинированная');
    });

    it('группирует продукты по уникальному коду — 1 вызов Claude на 2 продукта с одинаковым кодом', async () => {
      const interp = makeInterpretation('1234567890');
      const { service, messagesCreate } = createService({ items: [interp] });
      const p1 = makeProduct({ tnVedCode: '1234567890', description: 'A' });
      const p2 = makeProduct({ tnVedCode: '1234567890', description: 'B' });

      const { products } = await service.interpret([p1, p2]);

      expect(messagesCreate).toHaveBeenCalledTimes(1);
      expect(products[0].dutyInterpretation).toEqual(interp);
      expect(products[1].dutyInterpretation).toEqual(interp);
    });

    it('использует кэш — повторный interpret() того же кода не идёт в Claude', async () => {
      const interp = makeInterpretation('1234567890');
      const { service, messagesCreate } = createService({ items: [interp] });
      const product = makeProduct({ tnVedCode: '1234567890' });

      await service.interpret([product]);
      await service.interpret([product]);

      expect(messagesCreate).toHaveBeenCalledTimes(1);
    });

    it('батчит по 5 кодов — 7 уникальных кодов → 2 вызова Claude', async () => {
      const codes = Array.from({ length: 7 }, (_, i) => `${1000000000 + i}`);
      const itemsByCall = [
        codes.slice(0, 5).map((c) => makeInterpretation(c)),
        codes.slice(5).map((c) => makeInterpretation(c)),
      ];
      const { service, messagesCreate } = createService({ itemsByCall });
      const products = codes.map((c) =>
        makeProduct({ tnVedCode: c, tnvedRaw: makeTnvedCode(c) }),
      );

      const result = await service.interpret(products);

      expect(messagesCreate).toHaveBeenCalledTimes(2);
      expect(result.products.every((p) => p.dutyInterpretation !== null)).toBe(true);
    });

    it('использует tnvedRaw из продукта и не зовёт TKS', async () => {
      const { service, getTnvedCode } = createService({
        items: [makeInterpretation('1234567890')],
      });
      const product = makeProduct({
        tnVedCode: '1234567890',
        tnvedRaw: makeTnvedCode('1234567890'),
      });

      await service.interpret([product]);

      expect(getTnvedCode).not.toHaveBeenCalled();
    });

    it('идёт в TKS если tnvedRaw отсутствует', async () => {
      const raw = makeTnvedCode('1234567890');
      const { service, getTnvedCode } = createService({
        items: [makeInterpretation('1234567890')],
        tnvedByCode: { '1234567890': raw },
      });
      const product = makeProduct({ tnVedCode: '1234567890', tnvedRaw: undefined });

      await service.interpret([product]);

      expect(getTnvedCode).toHaveBeenCalledWith('1234567890');
    });

    it('пропускает коды, для которых TKS вернул ошибку', async () => {
      const { service, messagesCreate } = createService({
        items: [],
        tksFetchError: new Error('TKS down'),
      });
      const product = makeProduct({ tnVedCode: '1234567890', tnvedRaw: undefined });

      const { products } = await service.interpret([product]);

      // Нет tnvedRaw и TKS упал — Claude не вызывается (нет валидных кодов)
      expect(messagesCreate).not.toHaveBeenCalled();
      expect(products[0].dutyInterpretation).toBeNull();
    });

    it('при ошибке Claude — продукт получает dutyInterpretation=null и warning для нетривиальных ставок', async () => {
      const { service } = createService({
        claudeError: new Error('Claude timeout'),
      });
      const product = makeProduct({
        tnVedCode: '1234567890',
        tnvedRaw: makeTnvedCode('1234567890', { IMPSIGN: '>', IMP2: 1 }),
      });

      const { products } = await service.interpret([product]);

      expect(products[0].dutyInterpretation).toBeNull();
      expect(products[0].notes).toHaveLength(1);
      expect(products[0].notes[0].severity).toBe('warning');
      expect(products[0].notes[0].message).toContain('AI-интерпретация');
    });

    it('при ошибке Claude — простой продукт (только ад валорный) без warning', async () => {
      const { service } = createService({
        claudeError: new Error('Claude timeout'),
      });
      const product = makeProduct({ tnVedCode: '1234567890' }); // ad valorem only

      const { products } = await service.interpret([product]);

      expect(products[0].dutyInterpretation).toBeNull();
      expect(products[0].notes).toEqual([]);
    });

    it('пропускает продукты без tnVedCode', async () => {
      const { service, messagesCreate } = createService();
      const product = makeProduct({ tnVedCode: '' });

      const { products } = await service.interpret([product]);

      expect(messagesCreate).not.toHaveBeenCalled();
      expect(products[0].dutyInterpretation).toBeNull();
    });

    it('при language!=ru — в prompt добавляется инструкция про reasoningLocalized', async () => {
      const { service, messagesCreate } = createService({
        items: [makeInterpretation('1234567890', { reasoningLocalized: 'Ad valorem 10%' })],
      });
      const product = makeProduct({ tnVedCode: '1234567890' });

      await service.interpret([product], 'en');

      const call = messagesCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('reasoningLocalized');
      expect(call.messages[0].content).toContain('английском');
    });

    it('при language=zh — инструкция на китайский', async () => {
      const { service, messagesCreate } = createService({
        items: [makeInterpretation('1234567890')],
      });
      const product = makeProduct({ tnVedCode: '1234567890' });

      await service.interpret([product], 'zh');

      const call = messagesCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('китайском');
    });

    it('info note получает messageLocalized при наличии reasoningLocalized', async () => {
      const { service } = createService({
        items: [makeInterpretation('1234567890', { reasoningLocalized: 'Ad valorem 10 percent' })],
      });
      const product = makeProduct({ tnVedCode: '1234567890' });

      const { products } = await service.interpret([product], 'en');

      expect(products[0].notes[0].messageLocalized).toBe(
        'Duty rate interpretation: Ad valorem 10 percent',
      );
    });

    it('tool_choice принудительно вызывает interpret_duties', async () => {
      const { service, messagesCreate } = createService({
        items: [makeInterpretation('1234567890')],
      });
      const product = makeProduct({ tnVedCode: '1234567890' });

      await service.interpret([product]);

      const call = messagesCreate.mock.calls[0][0];
      expect(call.tool_choice).toEqual({ type: 'any' });
      expect(call.tools).toHaveLength(1);
      expect(call.tools[0].name).toBe('interpret_duties');
    });

    it('извлекает tokenUsage из ответа Claude', async () => {
      const { service, messagesCreate } = createService({
        items: [makeInterpretation('1234567890')],
      });
      messagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'interpret_duties',
            input: { items: [makeInterpretation('1234567890')] },
          },
        ],
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      });
      const product = makeProduct({ tnVedCode: '1234567890' });

      const { tokenUsage } = await service.interpret([product]);

      const modelUsage = tokenUsage['claude-opus-4-7'];
      expect(modelUsage).toBeDefined();
      expect(modelUsage.inputTokens).toBe(500);
      expect(modelUsage.outputTokens).toBe(200);
    });
  });

  describe('фильтрация conditions по PRIZNAK', () => {
    it('в payload попадают только релевантные PRIZNAK (1,2,3,16,19,20,30)', async () => {
      const { service, messagesCreate } = createService({
        items: [makeInterpretation('8708705009')],
      });
      const tnvedall: Record<string, TnvedallEntry[]> = {
        '1': [{ MIN: 5, PRIZNAK: 1 } as TnvedallEntry],
        '3': [{ MIN: 22, PRIZNAK: 3 } as TnvedallEntry],
        '15': [{ NOTE: 'Санкции-ограничение', PRIZNAK: 15 } as TnvedallEntry],
        '19': [{ CU: '156', MIN: 33.69, PRIZNAK: 19 } as TnvedallEntry],
        '28': [{ NOTE: 'Эксперимент-по-маркировке', PRIZNAK: 28 } as TnvedallEntry],
        '34': [{ NOTE: 'Санкции-страны', PRIZNAK: 34 } as TnvedallEntry],
      };
      const product = makeProduct({
        tnVedCode: '8708705009',
        tnvedRaw: makeTnvedCode('8708705009', {}, tnvedall),
      });

      await service.interpret([product]);

      const content = messagesCreate.mock.calls[0][0].messages[0].content as string;
      expect(content).toContain('"1"');
      expect(content).toContain('"3"');
      expect(content).toContain('"19"');
      expect(content).not.toContain('Санкции-ограничение');
      expect(content).not.toContain('Эксперимент-по-маркировке');
      expect(content).not.toContain('Санкции-страны');
    });
  });

  describe('адаптивный батчинг', () => {
    it('тяжёлый код с большим conditions уходит в отдельный батч', async () => {
      // Conditions > HEAVY_CONDITIONS_THRESHOLD (6000 символов JSON).
      const heavyEntries: TnvedallEntry[] = Array.from({ length: 20 }, (_, i) => ({
        CU: String(100 + i),
        MIN: 10 + i,
        PRIZNAK: 19,
        NOTE: 'Условие применения ставки для страны '.repeat(10),
      })) as TnvedallEntry[];
      const heavyTnved = makeTnvedCode('8708705009', {}, { '19': heavyEntries });
      const lightTnved = makeTnvedCode('1234567890');

      const { service, messagesCreate } = createService({
        itemsByCall: [
          [makeInterpretation('8708705009')],
          [makeInterpretation('1234567890')],
        ],
      });
      const products = [
        makeProduct({ tnVedCode: '8708705009', tnvedRaw: heavyTnved }),
        makeProduct({ tnVedCode: '1234567890', tnvedRaw: lightTnved }),
      ];

      await service.interpret(products);

      expect(messagesCreate).toHaveBeenCalledTimes(2);
      const first = messagesCreate.mock.calls[0][0].messages[0].content as string;
      const second = messagesCreate.mock.calls[1][0].messages[0].content as string;
      expect(first).toContain('8708705009');
      expect(first).not.toContain('1234567890');
      expect(second).toContain('1234567890');
      expect(second).not.toContain('8708705009');
    });

    it('несколько лёгких кодов группируются в один батч', async () => {
      const codes = ['1111111111', '2222222222', '3333333333'];
      const { service, messagesCreate } = createService({
        items: codes.map((c) => makeInterpretation(c)),
      });
      const products = codes.map((c) =>
        makeProduct({ tnVedCode: c, tnvedRaw: makeTnvedCode(c) }),
      );

      await service.interpret(products);

      expect(messagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('country-conditional charges', () => {
    it('парсит антидемпинговую ставку с appliesWhen.country', async () => {
      const interp = makeInterpretation('7326909809', {
        charges: [
          {
            type: 'import_duty',
            label: 'Ввозная',
            method: { kind: 'ad_valorem', rate: 5 },
            base: 'customs_value',
          },
          {
            type: 'antidumping',
            label: 'Антидемпинг',
            method: { kind: 'ad_valorem', rate: 35 },
            base: 'customs_value',
            appliesWhen: { country: '156', conditions: 'Решение ЕЭК N 7 от 14.01.2025' },
          },
        ],
      });
      const { service } = createService({ items: [interp] });
      const product = makeProduct({ tnVedCode: '7326909809' });

      const { products } = await service.interpret([product]);

      const charges = products[0].dutyInterpretation!.charges;
      expect(charges).toHaveLength(2);
      const antidump = charges.find((c) => c.type === 'antidumping')!;
      expect(antidump.appliesWhen?.country).toBe('156');
      expect(antidump.appliesWhen?.conditions).toContain('ЕЭК');
    });
  });

  describe('usedFallback', () => {
    it('false — Claude отключён и все ставки тривиальные (простой адвалор)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({ dutyRate: 7.5, exciseRate: 0, dutySign: null, dutyMin: null });
      const result = await service.interpret([product]);
      expect(result.usedFallback).toBe(false);
    });

    it('true — Claude отключён, у товара нетривиальные ставки (комбинированная)', async () => {
      const { service } = createService({ claudeEnabled: false });
      const product = makeProduct({
        tnvedRaw: makeTnvedCode('0000000000', { IMPSIGN: '>', IMP2: 0.5, IMPEDI2: 'EUR/кг' }),
      });
      const result = await service.interpret([product]);
      expect(result.usedFallback).toBe(true);
    });

    it('true — Claude упал для всех батчей, интерпретация не получена', async () => {
      const code = '2202100000';
      const rawCode = makeTnvedCode(code, { IMP: 10, IMPSIGN: '>', IMP2: 0.08, IMPEDI2: 'EUR/л' });
      const { service } = createService({
        claudeError: new Error('Request timed out'),
        tnvedByCode: { [code]: rawCode },
      });
      const product = makeProduct({ tnVedCode: code, tnvedRaw: rawCode });
      const result = await service.interpret([product]);
      expect(result.products[0].dutyInterpretation).toBeNull();
      expect(result.usedFallback).toBe(true);
    });

    it('false — Claude вернул интерпретацию для всех запрошенных кодов', async () => {
      const code = '8516101000';
      const { service } = createService({
        items: [makeInterpretation(code)],
        tnvedByCode: { [code]: makeTnvedCode(code) },
      });
      const product = makeProduct({ tnVedCode: code });
      const result = await service.interpret([product]);
      expect(result.usedFallback).toBe(false);
    });
  });
});
