import { CalculatorService, formatDutyRate, normalizePer } from './calculator.service';
import type { CalculatorInput } from './calculator.service';
import type { DutyInterpretation, DutyChargeRule } from '../duty-interpreter/interfaces';
import type { ProductNote } from '../common/product-notes';

/** Минимальный валидный CalculatorInput */
function makeProduct(overrides: Partial<CalculatorInput> = {}): CalculatorInput {
  return {
    description: 'Тестовый товар',
    quantity: 10,
    price: 100, // за единицу
    weight: 2, // кг за единицу
    tnVedCode: '8516101000',
    tnVedDescription: 'Чайники электрические',
    dutyRate: 7.5,
    dutyRateUnit: null,
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
    ...overrides,
  };
}

describe('normalizePer', () => {
  it.each([
    ['кг', 'kg'],
    ['kg', 'kg'],
    ['КГ', 'kg'],
    ['шт', 'pcs'],
    ['pcs', 'pcs'],
    ['штука', 'pcs'],
    ['штуки', 'pcs'],
    ['м2', 'm2'],
    ['m²', 'm2'],
    ['м²', 'm2'],
    ['кв.м', 'm2'],
    ['м3', 'm3'],
    ['m³', 'm3'],
    ['куб.м', 'm3'],
    ['л', 'l'],
    ['l', 'l'],
    ['литр', 'l'],
    ['liter', 'l'],
    ['г', 'g'],
    ['gram', 'g'],
    ['т', 't'],
    ['ton', 't'],
    ['EUR/кг', 'kg'],
    ['EUR/л', 'l'],
    ['EUR/пар', 'pair'],
    ['пара', 'pair'],
    ['EUR/1000шт', 'kpcs'],
    ['1000шт', 'kpcs'],
    ['EUR/см³', 'cm3'],
    ['см3', 'cm3'],
    ['cc', 'cm3'],
    ['EUR/КВТ', 'kw'],
    ['kw', 'kw'],
    ['EUR/Л.С.', 'hp'],
    ['л.с.', 'hp'],
    ['hp', 'hp'],
    ['EUR/кар', 'ct'],
    ['ct', 'ct'],
    ['EUR/м', 'm'],
    ['EUR/1000м³', 'km3'],
    ['1000м3', 'km3'],
    ['EUR/1000л', 'kl'],
    ['1000л', 'kl'],
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('normalizePer(%j) → %j', (input, expected) => {
    expect(normalizePer(input as any)).toBe(expected);
  });
});

describe('formatDutyRate', () => {
  const charge = (method: DutyChargeRule['method']): DutyChargeRule => ({
    type: 'import_duty',
    label: 'Ввозная',
    method,
    base: 'customs_value',
  });

  it('ad_valorem → "10%"', () => {
    expect(formatDutyRate([charge({ kind: 'ad_valorem', rate: 10 })])).toBe('10%');
  });

  it('specific EUR/pair → "0.34 €/пара"', () => {
    expect(
      formatDutyRate([charge({ kind: 'specific', amount: 0.34, unit: 'EUR', per: 'pair' })]),
    ).toBe('0.34 €/пара');
  });

  it('combined_min → "10% ≥ 0.34 €/пара"', () => {
    expect(
      formatDutyRate([
        charge({ kind: 'combined_min', rate: 10, specificAmount: 0.34, unit: 'EUR', per: 'pair' }),
      ]),
    ).toBe('10% ≥ 0.34 €/пара');
  });

  it('combined_max → "10% ≤ 0.34 €/пара"', () => {
    expect(
      formatDutyRate([
        charge({ kind: 'combined_max', rate: 10, specificAmount: 0.34, unit: 'EUR', per: 'pair' }),
      ]),
    ).toBe('10% ≤ 0.34 €/пара');
  });

  it('несколько duty-charges соединяются через " + "', () => {
    expect(
      formatDutyRate([
        charge({ kind: 'ad_valorem', rate: 5 }),
        { ...charge({ kind: 'ad_valorem', rate: 3 }), type: 'antidumping' },
      ]),
    ).toBe('5% + 3%');
  });

  it('только НДС → "—"', () => {
    expect(
      formatDutyRate([
        { ...charge({ kind: 'ad_valorem', rate: 20 }), type: 'vat' },
      ]),
    ).toBe('—');
  });

  it('обрезает trailing zeros: 0.5 → "0.5", 10 → "10"', () => {
    expect(formatDutyRate([charge({ kind: 'ad_valorem', rate: 10 })])).toBe('10%');
    expect(
      formatDutyRate([charge({ kind: 'specific', amount: 0.5, unit: 'EUR', per: 'kg' })]),
    ).toBe('0.5 €/кг');
  });
});

describe('CalculatorService', () => {
  let service: CalculatorService;

  beforeEach(() => {
    service = new CalculatorService();
  });

  describe('Адвалорная пошлина (простая ставка %)', () => {
    it('рассчитывает пошлину, НДС и итого для простого товара', () => {
      // price=100, qty=10 → totalPrice=1000
      // duty=7.5% от 1000=75, excise=0
      // vat=20% от (1000+75+0)=215
      // totalCost=1000+75+215+0+0=1290
      const result = service.calculate([makeProduct()]);

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.totalPrice).toBe(1000);
      expect(item.dutyAmount).toBe(75);
      expect(item.vatAmount).toBeCloseTo(215);
      expect(item.exciseAmount).toBe(0);
      expect(item.totalCost).toBeCloseTo(1290);
      expect(item.dutyAmountIsEstimate).toBe(false);
      expect(item.dutyFormula).toBeNull();
      expect(item.dutyRateDisplay).toBe('7.5%');
    });

    it('рассчитывает с акцизом', () => {
      // totalPrice=1000, duty=10%=100, excise=5%=50
      // vat=20% от (1000+100+50)=230
      const result = service.calculate(
        [makeProduct({ dutyRate: 10, exciseRate: 5 })],
      );
      const item = result.items[0];
      expect(item.dutyAmount).toBe(100);
      expect(item.exciseAmount).toBe(50);
      expect(item.vatAmount).toBeCloseTo(230);
      expect(item.totalCost).toBeCloseTo(1380);
    });

    it('нулевые ставки → нулевые суммы', () => {
      const result = service.calculate(
        [makeProduct({ dutyRate: 0, vatRate: 0, exciseRate: 0 })],
      );
      const item = result.items[0];
      expect(item.dutyAmount).toBe(0);
      expect(item.vatAmount).toBe(0);
      expect(item.exciseAmount).toBe(0);
      expect(item.totalCost).toBe(1000); // только totalPrice
    });
  });

  describe('Специфическая пошлина (EUR за единицу)', () => {
    it('рассчитывает пошлину в EUR/кг с конвертацией', () => {
      // dutyRate=0 (нет адвалорной части), только specific
      // 0.5 EUR/кг, eurToDoc=90 (1 EUR = 90 условных единиц документа)
      // weight=2кг * qty=10 = 20кг → 0.5 * 90 * 20 = 900
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.5,
        dutyMinUnit: 'кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      const item = result.items[0];
      expect(item.dutyAmount).toBe(900);
      expect(item.dutyAmountIsEstimate).toBe(false);
      expect(item.dutyBase).toBe('kg');
    });

    it('возвращает estimate если ставка в м² а dimensions нет', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      const item = result.items[0];
      expect(item.dutyAmount).toBe(0); // не можем посчитать
      expect(item.dutyAmountIsEstimate).toBe(true);
      expect(item.dutyBase).toBe('m2');
      expect(item.dutyFormula).toBeTruthy();
      expect(item.calculationStatus).toBe('needs_info');
    });

    it('рассчитывает specific пошлину в м² при наличии dimensions', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
        dimensions: [{ name: 'площадь', value: 5, unit: 'm2' }],
      });
      // 0.38 * eurToDoc(90) * 5м²*10шт = 0.38 * 90 * 50 = 1710
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBeCloseTo(1710);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('рассчитывает specific пошлину в шт', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 2,
        dutyMinUnit: 'шт',
        quantity: 10,
      });
      // 2 EUR * eurToDoc(1) * 10шт = 20
      const result = service.calculate([product], { eurToDoc: 1 });
      expect(result.items[0].dutyAmount).toBe(20);
    });

    it('IMP с IMPEDI единицей (0.34 EUR/пар) → specific, не адвалорная', () => {
      // Обувь 6402999100: TKS возвращает IMP=0.34, IMPEDI=715. До фикса считалось как 34%.
      const product = makeProduct({
        quantity: 60,
        price: 23.5,
        dutyRate: 0.34,
        dutyRateUnit: 'EUR/пар',
        dutyMin: null,
        dutyMinUnit: null,
      });
      const result = service.calculate([product], { eurToDoc: 10 });
      expect(result.items[0].dutyAmount).toBeCloseTo(204);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
      expect(result.items[0].dutyBase).toBe('pair');
    });

    it('IMP с IMPEDI="%" остаётся адвалорным', () => {
      const product = makeProduct({ dutyRate: 10, dutyRateUnit: '%' });
      const result = service.calculate([product]);
      expect(result.items[0].dutyAmount).toBe(100);
    });

    it('рассчитывает specific пошлину в EUR/1000шт (ОКЕИ 798)', () => {
      const product = makeProduct({ quantity: 500, dutyRate: 6, dutyRateUnit: 'EUR/1000шт' });
      const result = service.calculate([product], { eurToDoc: 100 });
      expect(result.items[0].dutyAmount).toBe(300);
      expect(result.items[0].dutyBase).toBe('kpcs');
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('рассчитывает specific пошлину в EUR/г через weight', () => {
      const product = makeProduct({
        weight: 2,
        quantity: 10,
        dutyRate: 0.2,
        dutyRateUnit: 'EUR/г',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(360000);
      expect(result.items[0].dutyBase).toBe('g');
    });

    it('рассчитывает specific пошлину в EUR/т через weight', () => {
      const product = makeProduct({
        weight: 2,
        quantity: 10,
        dutyRate: 500,
        dutyRateUnit: 'EUR/т',
      });
      const result = service.calculate([product], { eurToDoc: 100 });
      expect(result.items[0].dutyAmount).toBe(1000);
      expect(result.items[0].dutyBase).toBe('t');
    });

    it('specific пошлина в EUR/см³ без dimensions → estimate+blocker', () => {
      const product = makeProduct({ dutyRate: 0.5, dutyRateUnit: 'EUR/см³' });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(0);
      expect(result.items[0].dutyAmountIsEstimate).toBe(true);
      expect(result.items[0].dutyBase).toBe('cm3');
      expect(result.items[0].dutyFormula).toMatch(/см³/);
    });

    it('specific пошлина EUR/см³ с dimensions', () => {
      const product = makeProduct({
        quantity: 5,
        dutyRate: 0.5,
        dutyRateUnit: 'EUR/см³',
        dimensions: [{ name: 'engine', value: 2000, unit: 'см³' }],
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(450000);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('две specific IMP+IMP2 "но не менее" → max из обеих частей (combined_specific_min)', () => {
      // IMP=0.5 EUR/пар (0.5*90*10=450), IMP2=2 EUR/кг (2*90*20=3600), IMPSIGN='>' → max=3600
      const product = makeProduct({
        quantity: 10,
        dutyRate: 0.5,
        dutyRateUnit: 'EUR/пар',
        dutySign: '>',
        dutyMin: 2,
        dutyMinUnit: 'EUR/кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      const item = result.items[0];
      expect(item.dutyAmount).toBe(3600);
      expect(item.dutyAmountIsEstimate).toBe(false);
    });

    it('две specific "но не более" → min из обеих частей (combined_specific_max)', () => {
      const product = makeProduct({
        quantity: 10,
        dutyRate: 0.5,
        dutyRateUnit: 'EUR/пар',
        dutySign: '<',
        dutyMin: 2,
        dutyMinUnit: 'EUR/кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(450); // min(450, 3600)
    });
  });

  describe('Комбинированная ставка combined_min (но не менее)', () => {
    it('берёт max(адвалорная, специфическая) — специфическая больше', () => {
      // dutyRate=5%, dutySign='>' (combined_min), dutyMin=2 EUR/кг
      // totalPrice=1000, adValorem=50, specific=2*90*20=3600 → max=3600
      const product = makeProduct({
        dutyRate: 5,
        dutySign: '>',
        dutyMin: 2,
        dutyMinUnit: 'кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(3600);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('берёт max(адвалорная, специфическая) — адвалорная больше', () => {
      // dutyRate=50%, dutyMin=0.01 EUR/кг
      // adValorem=500, specific=0.01*90*20=18 → max=500
      const product = makeProduct({
        dutyRate: 50,
        dutySign: '>',
        dutyMin: 0.01,
        dutyMinUnit: 'кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(500);
    });

    it('fallback на адвалорную при отсутствии dimensions (estimate)', () => {
      const product = makeProduct({
        dutyRate: 5,
        dutySign: '>',
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      // adValorem=50, specific нельзя посчитать → возвращаем 50 как estimate
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(50);
      expect(result.items[0].dutyAmountIsEstimate).toBe(true);
    });
  });

  describe('Комбинированная ставка combined_max (но не более)', () => {
    it('берёт min(адвалорная, специфическая)', () => {
      // dutySign='<' → combined_max
      // adValorem=50, specific=2*90*20=3600 → min=50
      const product = makeProduct({
        dutyRate: 5,
        dutySign: '<',
        dutyMin: 2,
        dutyMinUnit: 'кг',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(50);
    });
  });

  describe('AI DutyInterpretation (charges из Claude)', () => {
    it('использует charges из dutyInterpretation вместо TKS-полей', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввозная пошлина',
          method: { kind: 'ad_valorem', rate: 12 },
          base: 'customs_value',
        },
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 20 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const interpretation: DutyInterpretation = {
        tnvedCode: '8516101000',
        charges,
        reasoning: 'test',
      };
      const product = makeProduct({
        dutyRate: 7.5, // игнорируется — есть interpretation
        vatRate: 20,
        dutyInterpretation: interpretation,
      });
      const result = service.calculate([product]);
      // duty=12% от 1000=120, vat=20% от (1000+120)=224
      expect(result.items[0].dutyAmount).toBe(120);
      expect(result.items[0].vatAmount).toBeCloseTo(224);
    });

    it('fallback на TKS-поля если charges пустой', () => {
      const interpretation: DutyInterpretation = {
        tnvedCode: '8516101000',
        charges: [],
        reasoning: 'empty',
      };
      const product = makeProduct({ dutyInterpretation: interpretation });
      const result = service.calculate([product]);
      // Используются dutyRate=7.5, vatRate=20
      expect(result.items[0].dutyAmount).toBe(75);
    });

    it('антидемпинговая пошлина добавляется к duty', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввозная',
          method: { kind: 'ad_valorem', rate: 5 },
          base: 'customs_value',
        },
        {
          type: 'antidumping',
          label: 'Антидемпинговая',
          method: { kind: 'ad_valorem', rate: 3 },
          base: 'customs_value',
        },
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 20 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        dutyInterpretation: { tnvedCode: '1234', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      // duty = 5% + 3% = 80
      expect(result.items[0].dutyAmount).toBe(80);
    });

    it('несколько vat-charges от AI сворачиваются в один (НДС не удваивается)', () => {
      // Регрессия: коды с льготными ставками НДС (медизделия/детские товары/etc)
      // получали 2-3 vat-charges от AI, все они суммировались — НДС 44%/66%.
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввоз',
          method: { kind: 'ad_valorem', rate: 6.5 },
          base: 'customs_value',
        },
        {
          type: 'vat',
          label: 'НДС (стандартная)',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'vat',
          label: 'НДС 10% (медизделия)',
          method: { kind: 'ad_valorem', rate: 10 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'vat',
          label: 'НДС 0% (ТСР инвалидов)',
          method: { kind: 'ad_valorem', rate: 0 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: '3926200000', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      // totalPrice=1000, duty=65, vat=22% от 1065 = 234.3 (а НЕ 234.3+106.5+0=340.8)
      expect(result.items[0].dutyAmount).toBe(65);
      expect(result.items[0].vatAmount).toBeCloseTo(234.3);
      const warning = result.items[0].notes.find(
        (n) => n.severity === 'info' && n.field === 'vat',
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toMatch(/альтернативные ставки|льготн/i);
      // Применённая ставка 22% — должна быть указана. Дубликат базовой 22%
      // отсутствует, упомянуты только реальные альтернативы (10%, 0%).
      expect(warning!.message).toContain('22%');
      expect(warning!.message).toContain('10%');
      expect(warning!.message).toContain('0%');
    });

    it('один vat-charge с неверной ставкой подменяется на vatRate из TKS и появляется warning', () => {
      // AI вернул НДС 20%, а в TKS уже 22% (с 2026 г.). Должна применяться 22%,
      // и оператор должен увидеть, что AI предлагал альтернативу 20% (это
      // часто означает устаревшую интерпретацию AI до повышения ставки).
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 20 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        dutyRate: 0,
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].vatAmount).toBeCloseTo(220); // 22% от 1000
      const warning = result.items[0].notes.find(
        (n) => n.severity === 'info' && n.field === 'vat',
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('20%');
      expect(warning!.message).toContain('22%');
    });

    it('один vat-charge с уже правильной ставкой не меняется и не порождает warning', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввоз',
          method: { kind: 'ad_valorem', rate: 10 },
          base: 'customs_value',
        },
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      // duty=100, vat=22% × 1100 = 242
      expect(result.items[0].vatAmount).toBeCloseTo(242);
      expect(
        result.items[0].notes.find((n) => n.severity === 'info' && n.field === 'vat'),
      ).toBeUndefined();
    });

    it('vatRate=0 — AI vat-charges дропаются, NDS=0 авторитативно из TKS', () => {
      // Граничный случай: код без НДС в TKS (vatRate=0). AI vat-charges считаются
      // галлюцинацией и не применяются. Оператор получает warning со списком
      // альтернатив (чтобы знать, что AI что-то нашёл).
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС A',
          method: { kind: 'ad_valorem', rate: 5 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'vat',
          label: 'НДС B',
          method: { kind: 'ad_valorem', rate: 5 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        dutyRate: 0,
        vatRate: 0,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].vatAmount).toBe(0);
      // Сохраняем audit-trail: оператор должен увидеть, что AI вернул vat-charges,
      // несмотря на TKS NDS=0.
      const note = result.items[0].notes.find(
        (n) => n.severity === 'info' && n.field === 'vat',
      );
      expect(note).toBeDefined();
      // Сообщение для vatRate=0 НЕ должно содержать «льготу» — это абсурд (ниже 0% не бывает).
      expect(note!.message).not.toMatch(/льгот/i);
      expect(note!.message).toMatch(/NDS\s*=\s*0|не применяется/i);
    });

    it('NaN vatRate — Calculator не падает и не пишет NaN в результат', () => {
      // Защита от NaN: если upstream parse-логика когда-нибудь даст NaN (Number('')
      // от пустой колонки), Calculator должен обработать это как «НДС не применяется»,
      // а не размножать NaN по vatAmount/totalCost.
      const product = makeProduct({ vatRate: NaN as unknown as number });
      const result = service.calculate([product]);
      expect(Number.isFinite(result.items[0].vatAmount)).toBe(true);
      expect(result.items[0].vatAmount).toBe(0);
      expect(Number.isFinite(result.items[0].totalCost)).toBe(true);
    });

    it('rate как строка ("22") от JSONB-кэша — НЕ попадает в dropped как ложная альтернатива', () => {
      // Anthropic SDK не приводит типы из tool_use input; TypeORM JSONB сохраняет
      // shape. Если когда-нибудь rate окажется строкой '22', строгое сравнение
      // '22' !== 22 ложно срабатывало бы. Защита через Number().
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: '22' as unknown as number },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].vatAmount).toBeCloseTo(220); // 22% × 1000
      // Note не должен порождаться: ставка совпала после приведения типов.
      expect(
        result.items[0].notes.find((n) => n.severity === 'info' && n.field === 'vat'),
      ).toBeUndefined();
    });

    it('AI не вернул vat при vatRate>0 — Calculator синтезирует НДС', () => {
      // Если AI забыл vat-charge, а TKS говорит NDS=22, должен быть посчитан 22%.
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввоз',
          method: { kind: 'ad_valorem', rate: 10 },
          base: 'customs_value',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].dutyAmount).toBe(100); // 10% × 1000
      expect(result.items[0].vatAmount).toBeCloseTo(242); // 22% × 1100
    });

    it('non-ad_valorem vat-charge от AI (галлюцинация) полностью игнорируется', () => {
      // НДС в РФ всегда адвалорный; specific/combined-vat — это галлюцинация,
      // расчёт должен использовать авторитативный vatRate из TKS.
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'specific', amount: 5, unit: 'EUR', per: 'kg' },
          base: 'customs_value',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].vatAmount).toBeCloseTo(220); // 22% × 1000, а не 5 EUR × kg
    });

    it('vat помещается ПОСЛЕ всех non-vat charges, даже если AI вернул его раньше', () => {
      // Регрессия: до фикса collapseVatCharges клал vat на позицию ПЕРВОГО vat
      // в input. Если AI вернул [vat, duty], НДС считался от голой суммы,
      // без учёта пошлины — недосчёт ~7%.
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС (раньше пошлины)',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'import_duty',
          label: 'Ввоз',
          method: { kind: 'ad_valorem', rate: 7.5 },
          base: 'customs_value',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].dutyAmount).toBe(75); // 7.5% × 1000
      // НДС 22% от (1000 + 75) = 236.5, а НЕ 22% × 1000 = 220.
      expect(result.items[0].vatAmount).toBeCloseTo(236.5);
    });

    it('messageLocalized для bot users (en/zh) на vat-warning', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'vat',
          label: 'НДС 10% (медизделия)',
          method: { kind: 'ad_valorem', rate: 10 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const productEn = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const en = service.calculate([productEn], { language: 'en' });
      const enWarning = en.items[0].notes.find((n) => n.severity === 'info' && n.field === 'vat');
      expect(enWarning?.messageLocalized).toBeDefined();
      expect(enWarning!.messageLocalized).toMatch(/VAT|alternative|reduced/i);

      const zh = service.calculate([productEn], { language: 'zh' });
      const zhWarning = zh.items[0].notes.find((n) => n.severity === 'info' && n.field === 'vat');
      expect(zhWarning?.messageLocalized).toBeDefined();
      expect(zhWarning!.messageLocalized).toContain('增值税');
    });

    it('dropped не содержит дубликаты той же ставки vatRate (только реальные альтернативы)', () => {
      // На stage встречаются коды с AI-галлюцинацией: [vat 22%, vat 22%] —
      // дубликат базовой ставки. В warning об этом писать нечего.
      const charges: DutyChargeRule[] = [
        {
          type: 'vat',
          label: 'НДС',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
        {
          type: 'vat',
          label: 'НДС (стандартная ставка)',
          method: { kind: 'ad_valorem', rate: 22 },
          base: 'customs_value_plus_duty_plus_excise',
        },
      ];
      const product = makeProduct({
        vatRate: 22,
        dutyInterpretation: { tnvedCode: '4201000000', charges, reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].vatAmount).toBeCloseTo(220);
      // Дубликат базовой ставки — warning не порождается, оператора не нужно
      // отвлекать на это.
      expect(
        result.items[0].notes.find((n) => n.severity === 'info' && n.field === 'vat'),
      ).toBeUndefined();
    });

    // Регрессии с реальных stage-кодов: до фикса для каждого AI возвращал N vat-charges,
    // НДС умножался на N. После фикса должен применяться только базовый vatRate.
    type StageCase = {
      label: string;
      code: string;
      vatRate: number;
      dutyRate: number;
      preferentialVatRates: number[];
      expectedDuty: number;
      expectedVat: number;
    };
    const stageCases: StageCase[] = [
      // 3926200000 (детская одежда из пластмасс): 22% + 10% (детское) + 10% (медиз)
      {
        label: '3926200000 — три vat-charges (22+10+10)',
        code: '3926200000',
        vatRate: 22,
        dutyRate: 6.5,
        preferentialVatRates: [10, 10],
        expectedDuty: 65,
        expectedVat: 234.3, // 22% × 1065
      },
      // 9503004900 (детские игрушки): 22% + 10% (детское) + 0% (ТСР)
      {
        label: '9503004900 — три vat-charges (22+10+0)',
        code: '9503004900',
        vatRate: 22,
        dutyRate: 0,
        preferentialVatRates: [10, 0],
        expectedDuty: 0,
        expectedVat: 220, // 22% × 1000
      },
      // 3923100000 (упаковка из пластмасс): 22% + 10% (медиз)
      {
        label: '3923100000 — два vat-charges (22+10)',
        code: '3923100000',
        vatRate: 22,
        dutyRate: 6.5,
        preferentialVatRates: [10],
        expectedDuty: 65,
        expectedVat: 234.3,
      },
      // 4820200000 (тетради): порядок vat-charges обратный (льготная первая, базовая второй)
      {
        label: '4820200000 — порядок [vat-льгота, vat-база, ...]',
        code: '4820200000',
        vatRate: 22,
        dutyRate: 5,
        preferentialVatRates: [10],
        expectedDuty: 50,
        expectedVat: 231, // 22% × 1050
      },
    ];

    it.each(stageCases)(
      'регрессия: $label — НДС не удваивается',
      ({ code, vatRate, dutyRate, preferentialVatRates, expectedDuty, expectedVat }) => {
        // Для 4820200000 порядок vat-charges специально обратный (льготная первая,
        // базовая второй) — проверяем, что collapseVatCharges всегда строит
        // синтетический vat-charge со ставкой из vatRate (TKS), независимо от того,
        // в каком порядке AI их отдал.
        const isReversed = code === '4820200000';
        const baseVat = {
          type: 'vat' as const,
          label: `НДС (база ${vatRate}%)`,
          method: { kind: 'ad_valorem' as const, rate: vatRate },
          base: 'customs_value_plus_duty_plus_excise' as const,
        };
        const prefVats = preferentialVatRates.map((rate) => ({
          type: 'vat' as const,
          label: `НДС (льгота ${rate}%)`,
          method: { kind: 'ad_valorem' as const, rate },
          base: 'customs_value_plus_duty_plus_excise' as const,
        }));
        const charges: DutyChargeRule[] = [
          ...(dutyRate > 0
            ? [
                {
                  type: 'import_duty' as const,
                  label: 'Ввоз',
                  method: { kind: 'ad_valorem' as const, rate: dutyRate },
                  base: 'customs_value' as const,
                },
              ]
            : []),
          ...(isReversed ? [...prefVats, baseVat] : [baseVat, ...prefVats]),
        ];
        const product = makeProduct({
          dutyRate: 0, // не используется, есть dutyInterpretation
          vatRate,
          dutyInterpretation: { tnvedCode: code, charges, reasoning: '' },
        });
        const result = service.calculate([product]);
        expect(result.items[0].dutyAmount).toBeCloseTo(expectedDuty);
        expect(result.items[0].vatAmount).toBeCloseTo(expectedVat);
        const warning = result.items[0].notes.find(
          (n) => n.severity === 'info' && n.field === 'vat',
        );
        expect(warning).toBeDefined();
        // Проверяем, что в note упомянуты ВСЕ выкинутые льготные ставки.
        for (const r of preferentialVatRates) {
          expect(warning!.message).toContain(`${r}%`);
        }
      },
    );
  });

  describe('Фильтрация charges по стране происхождения', () => {
    const baseCharges = (): DutyChargeRule[] => [
      {
        type: 'import_duty',
        label: 'Ввозная',
        method: { kind: 'ad_valorem', rate: 5 },
        base: 'customs_value',
      },
      {
        type: 'antidumping',
        label: 'Антидемпинг (Китай)',
        method: { kind: 'ad_valorem', rate: 33.69 },
        base: 'customs_value',
        appliesWhen: { country: '156', conditions: 'Только литые диски 13-20″' },
      },
      {
        type: 'antidumping',
        label: 'Антидемпинг (Турция)',
        method: { kind: 'ad_valorem', rate: 35.29 },
        base: 'customs_value',
        appliesWhen: { country: '792', conditions: 'Турция' },
      },
      {
        type: 'vat',
        label: 'НДС',
        method: { kind: 'ad_valorem', rate: 20 },
        base: 'customs_value_plus_duty_plus_excise',
      },
    ];

    it('countryOfOrigin=156 (Китай): применяется только китайская антидемпинговая', () => {
      const product = makeProduct({
        dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
      });
      const result = service.calculate([product], { countryOfOrigin: '156' });
      // duty = 5% + 33.69% от 1000 = 50 + 336.9 = 386.9
      expect(result.items[0].dutyAmount).toBeCloseTo(386.9);
    });

    it('countryOfOrigin=392 (Япония, нет совпадения): антидемпинговые не применяются', () => {
      const product = makeProduct({
        dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
      });
      const result = service.calculate([product], { countryOfOrigin: '392' });
      // duty = только 5% от 1000 = 50
      expect(result.items[0].dutyAmount).toBe(50);
    });

    it('countryOfOrigin не указан: ни одна страновая ставка не применяется', () => {
      const product = makeProduct({
        dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
      });
      const result = service.calculate([product]);
      expect(result.items[0].dutyAmount).toBe(50);
    });

    it('страна строки перекрывает страну документа (сборный инвойс)', () => {
      const products = [
        makeProduct({
          dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
        }),
        makeProduct({
          countryOfOrigin: '792', // Турция — своя страна у строки
          dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
        }),
      ];
      const result = service.calculate(products, { countryOfOrigin: '156' });

      // строка 1 — страна документа (Китай): 5% + 33.69%
      expect(result.items[0].dutyAmount).toBeCloseTo(386.9);
      // строка 2 — Турция: 5% + 35.29% = 402.9, плюс info-note о перекрытии
      expect(result.items[1].dutyAmount).toBeCloseTo(402.9);
      const note = result.items[1].notes.find(
        (n) => n.field === 'country' && n.severity === 'info',
      );
      expect(note).toBeDefined();
      expect(note!.message).toContain('792');
    });

    it('код страны с ведущим нулём нормализуется (12 → "012")', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'antidumping',
          label: 'Пример',
          method: { kind: 'ad_valorem', rate: 10 },
          base: 'customs_value',
          appliesWhen: { country: '012' },
        },
      ];
      const product = makeProduct({
        dutyRate: 0,
        vatRate: 0,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product], { countryOfOrigin: '12' });
      expect(result.items[0].dutyAmount).toBe(100);
    });

    it('антидемпинговая с conditions добавляет warning-note с текстом условий', () => {
      const product = makeProduct({
        dutyInterpretation: { tnvedCode: '8708705009', charges: baseCharges(), reasoning: '' },
      });
      const result = service.calculate([product], { countryOfOrigin: '156' });
      const warning = result.items[0].notes.find(
        (n) => n.severity === 'warning' && n.field === 'antidumping',
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toMatch(/литые диски 13-20/);
    });

    it('преференциальная ставка по стране (import_duty+country) вытесняет базовую', () => {
      const charges: DutyChargeRule[] = [
        {
          type: 'import_duty',
          label: 'Ввозная',
          method: { kind: 'ad_valorem', rate: 5 },
          base: 'customs_value',
        },
        {
          type: 'import_duty',
          label: 'Льгота (Вьетнам)',
          method: { kind: 'ad_valorem', rate: 0 },
          base: 'customs_value',
          appliesWhen: { country: '704', conditions: 'Соглашение с Вьетнамом' },
        },
      ];
      const product = makeProduct({
        vatRate: 0,
        dutyInterpretation: { tnvedCode: 'x', charges, reasoning: '' },
      });
      const result = service.calculate([product], { countryOfOrigin: '704' });
      // Осталась только преференциальная 0% — duty=0
      expect(result.items[0].dutyAmount).toBe(0);
      const info = result.items[0].notes.find(
        (n) => n.severity === 'info' && n.field === 'import_duty',
      );
      expect(info).toBeDefined();
      expect(info!.message).toMatch(/преференциальная/i);
    });
  });

  describe('VerificationStatus', () => {
    it('exact при matched=true и confidence >= дефолтного порога 0.8', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.8 })],
      );
      expect(result.items[0].verificationStatus).toBe('exact');
    });

    it('review при confidence < дефолтного порога 0.8', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.79 })],
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });

    it('review при matched=false', () => {
      const result = service.calculate(
        [makeProduct({ matched: false, matchConfidence: 0.95 })],
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });

    it('использует переданный порог вместо дефолтного', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.75 })],
        { confidenceThreshold: 0.7 },
      );
      expect(result.items[0].verificationStatus).toBe('exact');
    });

    it('review при confidence ниже переданного порога', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.85 })],
        { confidenceThreshold: 0.9 },
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });
  });

  describe('Unverified-строки (AI-классификация не отработала)', () => {
    it('review при verified=false даже с высоким matchConfidence (частотность TKS ≠ качество матча)', () => {
      const result = service.calculate(
        [makeProduct({ verified: false, matched: true, matchConfidence: 0.95 })],
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });
  });

  describe('Дедуп идентичных duty-charges от AI', () => {
    const dutyCharge = (rate: number): DutyChargeRule => ({
      type: 'import_duty',
      label: 'Ввозная пошлина',
      method: { kind: 'ad_valorem', rate },
      base: 'customs_value',
    });

    it('два полностью одинаковых import_duty считаются один раз (не двойная пошлина)', () => {
      const result = service.calculate(
        [
          makeProduct({
            dutyInterpretation: {
              tnvedCode: '8516101000',
              charges: [dutyCharge(10), dutyCharge(10)],
              requiredDimensions: [],
              reasoning: '',
            } as DutyInterpretation,
          }),
        ],
      );
      // 1000 × 10% = 100, а не 200
      expect(result.items[0].dutyAmount).toBe(100);
    });

    it('разные duty-charges (разные ставки) НЕ дедупятся — легитимные множественные пошлины', () => {
      const result = service.calculate(
        [
          makeProduct({
            dutyInterpretation: {
              tnvedCode: '8516101000',
              charges: [dutyCharge(10), dutyCharge(5)],
              requiredDimensions: [],
              reasoning: '',
            } as DutyInterpretation,
          }),
        ],
      );
      expect(result.items[0].dutyAmount).toBe(150);
    });
  });

  describe('Неизвестная единица IMPEDI в fallback-пути', () => {
    it('нераспознанная единица → пошлина не считается как адвалорная, blocker-note', () => {
      // Раньше «5 EUR/неизвестная-единица» трактовалось как 5% — тихое искажение пошлины.
      const result = service.calculate(
        [makeProduct({ dutyRate: 5, dutyRateUnit: '883' })],
      );
      const item = result.items[0];
      expect(item.dutyAmount).toBe(0);
      expect(item.calculationStatus).toBe('needs_info');
      expect(
        item.notes.some((n) => n.severity === 'blocker' && n.message.includes('не распознана')),
      ).toBe(true);
    });

    it('IMP с неизвестной единицей не мешает IMP2-составляющей посчитаться', () => {
      const result = service.calculate(
        [
          makeProduct({
            dutyRate: 5,
            dutyRateUnit: '883',
            dutyMin: 2,
            dutyMinUnit: 'EUR/кг',
          }),
        ],
        { eurToDoc: 90 },
      );
      // IMP2: 2 EUR/кг × 90 × (2 кг × 10 шт) = 3600
      expect(result.items[0].dutyAmount).toBe(3600);
    });
  });

  describe('Freight: невалидные строки', () => {
    it('строка с Infinity-весом не получает долю фрахта', () => {
      const broken = makeProduct({ weight: Infinity });
      const ok = makeProduct();
      const result = service.calculate([broken, ok], {
        freight: { totalInDocCurrency: 100, weightDenominator: 20 },
      });
      expect(result.items[0].freightShare).toBe(0);
      expect(result.items[1].freightShare).toBe(100);
    });
  });

  describe('Доп. единица измерения (supplementaryQuantity, графа 41 ДТ)', () => {
    it('шт/пары: количество берётся из quantity', () => {
      const product = makeProduct({ quantity: 24, supplementaryUnit: 'пар' });
      const result = service.calculate([product]);
      expect(result.items[0].supplementaryQuantity).toBe(24);
    });

    it('литры: количество берётся из dimensions × quantity', () => {
      const product = makeProduct({
        quantity: 10,
        supplementaryUnit: 'л',
        dimensions: [{ name: 'объём', value: 0.5, unit: 'l' }],
      });
      const result = service.calculate([product]);
      expect(result.items[0].supplementaryQuantity).toBeCloseTo(5, 5);
    });

    it('нет данных для доп. единицы → null + warning-note (не blocker)', () => {
      const product = makeProduct({ quantity: 10, supplementaryUnit: 'л' });
      const result = service.calculate([product]);
      const item = result.items[0];
      expect(item.supplementaryQuantity).toBeNull();
      const note = item.notes.find((n) => n.field === 'supplementary_unit');
      expect(note).toBeDefined();
      expect(note!.severity).toBe('warning');
      expect(note!.message).toContain('графа 41 ДТ');
      // Warning не блокирует расчёт: суммы посчитаны, статус partial
      expect(item.calculationStatus).toBe('partial');
      expect(item.dutyAmount).toBeGreaterThan(0);
    });

    it('код без доп. единицы: supplementaryQuantity=null и никаких заметок', () => {
      const result = service.calculate([makeProduct()]);
      const item = result.items[0];
      expect(item.supplementaryQuantity).toBeNull();
      expect(item.notes.find((n) => n.field === 'supplementary_unit')).toBeUndefined();
      expect(item.calculationStatus).toBe('exact');
    });
  });

  describe('CalculationStatus', () => {
    it('exact без заметок', () => {
      const result = service.calculate([makeProduct()]);
      expect(result.items[0].calculationStatus).toBe('exact');
    });

    it('needs_info при blocker (нет dimensions)', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product]);
      expect(result.items[0].calculationStatus).toBe('needs_info');
    });

    it('partial при warning в notes', () => {
      const product = makeProduct({
        notes: [{ stage: 'classify', severity: 'warning', message: 'low confidence' }],
      });
      const result = service.calculate([product]);
      expect(result.items[0].calculationStatus).toBe('partial');
    });

    it('error при blocker с field=code', () => {
      const product = makeProduct({
        notes: [{ stage: 'classify', severity: 'blocker', field: 'code', message: 'not found' }],
      });
      const result = service.calculate([product]);
      expect(result.items[0].calculationStatus).toBe('error');
    });
  });

  describe('Summarize (итоги по нескольким товарам)', () => {
    it('суммирует все позиции', () => {
      const products = [
        makeProduct({ price: 100, quantity: 10 }), // totalPrice=1000
        makeProduct({ price: 200, quantity: 5 }),  // totalPrice=1000
      ];
      const result = service.calculate(products);
      expect(result.items).toHaveLength(2);
      expect(result.totalDuty).toBe(result.items[0].dutyAmount + result.items[1].dutyAmount);
      expect(result.totalVat).toBe(result.items[0].vatAmount + result.items[1].vatAmount);
      expect(result.grandTotal).toBe(result.items[0].totalCost + result.items[1].totalCost);
    });

    it('пустой список → нулевые итоги', () => {
      const result = service.calculate([]);
      expect(result.items).toHaveLength(0);
      expect(result.grandTotal).toBe(0);
    });
  });

  describe('Freight (фрахт до границы)', () => {
    it('legacy: без freight-опции freightShare=0 на каждой позиции и totalFreight=0', () => {
      const product = makeProduct({ price: 1000, quantity: 1, weight: 1, vatRate: 22 });
      const result = service.calculate([product]);
      expect(result.items[0].freightShare).toBe(0);
      expect(result.totalFreight).toBe(0);
      // legacy формула: duty = 1000 * 0.075 = 75; vat = (1000+75)*0.22 = 236.5
      expect(result.items[0].dutyAmount).toBeCloseTo(75, 5);
      expect(result.items[0].vatAmount).toBeCloseTo(236.5, 5);
      expect(result.items[0].totalCost).toBeCloseTo(1000 + 75 + 236.5, 5);
    });

    it('freightShare включается в базу пошлины, НДС и в totalCost (ТК ЕАЭС)', () => {
      // 1 строка, weight*qty = 1*1 = 1, denominator=1 → вся сумма фрахта (100) идёт на эту строку.
      const product = makeProduct({ price: 1000, quantity: 1, weight: 1, dutyRate: 10, vatRate: 22 });
      const result = service.calculate([product], {
        freight: { totalInDocCurrency: 100, weightDenominator: 1 },
      });
      const item = result.items[0];
      expect(item.freightShare).toBe(100);
      expect(item.dutyAmount).toBeCloseTo(110, 5);
      expect(item.vatAmount).toBeCloseTo(266.2, 5);
      expect(item.totalCost).toBeCloseTo(1476.2, 5);
      expect(result.totalFreight).toBe(100);
    });

    it('распределение по двум строкам пропорционально weight × quantity', () => {
      const products = [
        makeProduct({ price: 1000, quantity: 1, weight: 3, dutyRate: 10, vatRate: 22 }),
        makeProduct({ price: 1000, quantity: 2, weight: 1, dutyRate: 10, vatRate: 22 }),
      ];
      // веса × qty: 3 и 2, знаменатель=5; всего фрахта=500 → 300 и 200.
      const result = service.calculate(products, {
        freight: { totalInDocCurrency: 500, weightDenominator: 5 },
      });
      expect(result.items[0].freightShare).toBeCloseTo(300, 5);
      expect(result.items[1].freightShare).toBeCloseTo(200, 5);
      expect(result.totalFreight).toBeCloseTo(500, 5);
    });

    it('при наличии weightGross фрахт распределяется по брутто (Решение ЕЭК № 83)', () => {
      const products = [
        makeProduct({ price: 1000, quantity: 1, weight: 2, weightGross: 3, dutyRate: 0, vatRate: 0 }),
        makeProduct({ price: 1000, quantity: 2, weight: 0.5, weightGross: 1, dutyRate: 0, vatRate: 0 }),
      ];
      // брутто × qty: 3 и 2, знаменатель=5; всего фрахта=500 → 300 и 200
      // (по нетто было бы 2 и 1 → 333.33 и 166.67).
      const result = service.calculate(products, {
        freight: { totalInDocCurrency: 500, weightDenominator: 5 },
      });
      expect(result.items[0].freightShare).toBeCloseTo(300, 5);
      expect(result.items[1].freightShare).toBeCloseTo(200, 5);
    });

    it('строка без weightGross участвует в распределении по нетто (смешанный документ)', () => {
      const products = [
        makeProduct({ price: 1000, quantity: 1, weight: 2, weightGross: 3, dutyRate: 0, vatRate: 0 }),
        makeProduct({ price: 1000, quantity: 1, weight: 2, dutyRate: 0, vatRate: 0 }),
      ];
      // базисы: 3 (брутто) и 2 (нетто), знаменатель=5 → 300 и 200.
      const result = service.calculate(products, {
        freight: { totalInDocCurrency: 500, weightDenominator: 5 },
      });
      expect(result.items[0].freightShare).toBeCloseTo(300, 5);
      expect(result.items[1].freightShare).toBeCloseTo(200, 5);
    });

    it('weightDenominator=0 → нули по всем строкам (защита от деления на ноль)', () => {
      const products = [
        makeProduct({ price: 1000, quantity: 1, weight: 1, dutyRate: 10, vatRate: 22 }),
      ];
      const result = service.calculate(products, {
        freight: { totalInDocCurrency: 100, weightDenominator: 0 },
      });
      expect(result.items[0].freightShare).toBe(0);
    });

    it('totalInDocCurrency=NaN → нули по всем строкам', () => {
      const products = [makeProduct({ price: 1000, dutyRate: 10, vatRate: 22 })];
      const result = service.calculate(products, {
        freight: { totalInDocCurrency: NaN, weightDenominator: 1 },
      });
      expect(result.items[0].freightShare).toBe(0);
    });

    it('строка с weight=0 не получает фрахт; знаменатель учитывает только остальных', () => {
      // Этот сценарий моделирует manual-code (calculator получает одну строку, но
      // denominator от всех 3 строк документа). Для строки с weight=0 share=0.
      const zeroWeightRow = makeProduct({
        price: 1000,
        quantity: 1,
        weight: 0,
        dutyRate: 10,
        vatRate: 22,
      });
      const result = service.calculate([zeroWeightRow], {
        freight: { totalInDocCurrency: 100, weightDenominator: 10 },
      });
      expect(result.items[0].freightShare).toBe(0);
    });

    it('акциз тоже считается от (цена + фрахт)', () => {
      const product = makeProduct({
        price: 1000,
        quantity: 1,
        weight: 1,
        dutyRate: 10,
        exciseRate: 5,
        vatRate: 22,
      });
      const result = service.calculate([product], {
        freight: { totalInDocCurrency: 200, weightDenominator: 1 },
      });
      const item = result.items[0];
      // customs_value = 1200; duty = 120; excise = 60; vat = (1200+120+60)*0.22 = 303.6
      expect(item.dutyAmount).toBeCloseTo(120, 5);
      expect(item.exciseAmount).toBeCloseTo(60, 5);
      expect(item.vatAmount).toBeCloseTo(303.6, 5);
    });
  });

  describe('eurToDoc по умолчанию', () => {
    it('eurToDoc=1 если не передан', () => {
      // specific: 0.5 EUR/кг, без eurToDoc → 0.5*1*20 = 10
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.5,
        dutyMinUnit: 'кг',
      });
      const result = service.calculate([product]);
      expect(result.items[0].dutyAmount).toBe(10);
    });
  });

  describe('Notes сохраняются из входных данных', () => {
    it('входные notes переносятся в результат', () => {
      const inputNote: ProductNote = {
        stage: 'classify',
        severity: 'info',
        message: 'Подобрано по ключевым словам',
      };
      const product = makeProduct({ notes: [inputNote] });
      const result = service.calculate([product]);
      expect(result.items[0].notes).toContainEqual(inputNote);
    });

    it('blocker notes добавляются калькулятором при estimate', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product]);
      const blockerNotes = result.items[0].notes.filter(
        (n) => n.stage === 'calculate' && n.severity === 'blocker',
      );
      expect(blockerNotes.length).toBeGreaterThan(0);
    });
  });

  describe('Мультивалютность specific-ставок', () => {
    it('specific в USD: берёт курс USD из currencyToDoc', () => {
      // IMPEDI=166D → "USD/кг". 0.5 USD/кг × 75 × 20кг = 750
      const product = makeProduct({
        dutyRate: 0.5,
        dutyRateUnit: 'USD/кг',
      });
      const result = service.calculate([product], {
        currencyToDoc: { USD: 75, EUR: 90 },
      });
      expect(result.items[0].dutyAmount).toBe(750);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('specific в RUB при документе в USD: берёт курс RUB', () => {
      const product = makeProduct({
        dutyRate: 10,
        dutyRateUnit: 'RUB/кг',
      });
      const result = service.calculate([product], {
        currencyToDoc: { USD: 1, RUB: 0.0125, EUR: 1.1 },
      });
      // 10 RUB/кг × 0.0125 × 20кг = 2.5 USD
      expect(result.items[0].dutyAmount).toBeCloseTo(2.5);
    });

    it('BYN (после нормализации из BYR-суффикса TKS) считается по курсу BYN', () => {
      const product = makeProduct({
        dutyRate: 1,
        dutyRateUnit: 'BYN/кг',
      });
      const result = service.calculate([product], {
        currencyToDoc: { BYN: 30, EUR: 90 },
      });
      expect(result.items[0].dutyAmount).toBe(600); // 1 × 30 × 20
    });

    it('отсутствие курса валюты → estimate с blocker', () => {
      const product = makeProduct({
        dutyRate: 1,
        dutyRateUnit: 'AMD/кг',
      });
      const result = service.calculate([product], {
        currencyToDoc: { EUR: 90 }, // нет AMD
      });
      const item = result.items[0];
      expect(item.dutyAmount).toBe(0);
      expect(item.dutyAmountIsEstimate).toBe(true);
      const blocker = item.notes.find(
        (n) => n.severity === 'blocker' && /курс AMD/.test(n.message),
      );
      expect(blocker).toBeDefined();
    });

    it('eurToDoc + currencyToDoc: currencyToDoc приоритетнее', () => {
      const product = makeProduct({
        dutyRate: 1,
        dutyRateUnit: 'EUR/кг',
      });
      const result = service.calculate([product], {
        eurToDoc: 50, // игнорируется
        currencyToDoc: { EUR: 100 },
      });
      expect(result.items[0].dutyAmount).toBe(2000); // 1 × 100 × 20
    });
  });

  describe('Редкие единицы OKEI', () => {
    it('акциз в EUR/л 100% спирта считается по dimensions[ethanol_l]', () => {
      // Бутылка 0.5 л алкоголя крепостью 40% → 0.2 л чистого спирта на штуку.
      // 5 штук → 1.0 л суммарно. Акциз 10 EUR/л 100% спирта × 90 × 1.0 = 900.
      const product = makeProduct({
        dutyRate: 0,
        vatRate: 0,
        exciseRate: 10,
        dutyRateUnit: null,
        quantity: 5,
        dutyInterpretation: {
          tnvedCode: '2208',
          reasoning: 'Акциз на этиловый спирт',
          charges: [
            {
              type: 'excise',
              label: 'Акциз',
              method: { kind: 'specific', amount: 10, unit: 'EUR', per: 'ethanol_l' },
              base: 'customs_value',
            },
          ],
        },
        dimensions: [{ name: 'ethanol', value: 0.2, unit: 'л 100% спирта' }],
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].exciseAmount).toBe(900);
    });

    it('пошлина в EUR/т п массы через dimensions', () => {
      const product = makeProduct({
        quantity: 1,
        dutyRate: 100,
        dutyRateUnit: 'EUR/т п массы',
        dimensions: [{ name: 'gross_mass', value: 5, unit: 'т п массы' }],
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      // 100 × 90 × 5 = 45000
      expect(result.items[0].dutyAmount).toBe(45000);
      expect(result.items[0].dutyBase).toBe('gross_mass_t');
    });

    it('пошлина в EUR/т грузоподъёмности через dimensions', () => {
      const product = makeProduct({
        quantity: 1,
        dutyRate: 50,
        dutyRateUnit: 'EUR/т грп',
        dimensions: [{ name: 'load_capacity', value: 10, unit: 'т грп' }],
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(45000); // 50 × 90 × 10
      expect(result.items[0].dutyBase).toBe('load_capacity_t');
    });
  });

  describe('combined_specific_min через AI-интерпретацию', () => {
    const charge = (method: DutyChargeRule['method']): DutyChargeRule => ({
      type: 'import_duty',
      label: 'Ввозная',
      method,
      base: 'customs_value',
    });

    it('combined_specific_min в разных валютах: max из двух посчитанных', () => {
      // 0.5 EUR/пара (0.5*90*10 = 450) ≥ 1 USD/кг (1*75*20 = 1500) → max=1500
      const product = makeProduct({
        quantity: 10,
        dutyInterpretation: {
          tnvedCode: '6402',
          reasoning: 'test',
          charges: [
            charge({
              kind: 'combined_specific_min',
              primary: { amount: 0.5, unit: 'EUR', per: 'pair' },
              fallback: { amount: 1, unit: 'USD', per: 'kg' },
            }),
          ],
        },
      });
      const result = service.calculate([product], {
        currencyToDoc: { EUR: 90, USD: 75 },
      });
      expect(result.items[0].dutyAmount).toBe(1500);
    });

    it('combined_specific_max: берёт min', () => {
      const product = makeProduct({
        quantity: 10,
        dutyInterpretation: {
          tnvedCode: '6402',
          reasoning: 'test',
          charges: [
            charge({
              kind: 'combined_specific_max',
              primary: { amount: 0.5, unit: 'EUR', per: 'pair' },
              fallback: { amount: 1, unit: 'EUR', per: 'kg' },
            }),
          ],
        },
      });
      // p1=0.5*90*10=450, p2=1*90*20=1800, min=450
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(450);
    });

    it('combined_specific_min: одна часть не рассчитана → estimate по другой', () => {
      const product = makeProduct({
        quantity: 10,
        dutyInterpretation: {
          tnvedCode: '6402',
          reasoning: 'test',
          charges: [
            charge({
              kind: 'combined_specific_min',
              primary: { amount: 0.5, unit: 'EUR', per: 'pair' }, // 450
              fallback: { amount: 1, unit: 'EUR', per: 'm2' },   // нет dimensions
            }),
          ],
        },
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(450);
      expect(result.items[0].dutyAmountIsEstimate).toBe(true);
      // dutyBase должен указывать на фактически посчитанную составляющую (pair), не primary.
      expect(result.items[0].dutyBase).toBe('pair');
    });

    it('dutyBase берётся от fallback, когда primary не рассчиталась', () => {
      const product = makeProduct({
        quantity: 10,
        dutyInterpretation: {
          tnvedCode: '6402',
          reasoning: 'test',
          charges: [
            charge({
              kind: 'combined_specific_min',
              primary: { amount: 0.5, unit: 'EUR', per: 'm2' },   // нет dimensions → ошибка
              fallback: { amount: 1, unit: 'EUR', per: 'pair' },  // 900
            }),
          ],
        },
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(900); // 1*90*10
      expect(result.items[0].dutyBase).toBe('pair'); // а не 'm2'
    });

    it('malformed AI-ответ (без primary/fallback) → estimate с blocker, без TypeError', () => {
      const product = makeProduct({
        quantity: 10,
        dutyInterpretation: {
          tnvedCode: '6402',
          reasoning: 'malformed',
          // primary/fallback отсутствуют в ответе LLM
          charges: [charge({ kind: 'combined_specific_min' } as any)],
        },
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(0);
      expect(result.items[0].dutyAmountIsEstimate).toBe(true);
      const blocker = result.items[0].notes.find(
        (n) => n.severity === 'blocker' && /неполные данные/.test(n.message),
      );
      expect(blocker).toBeDefined();
    });
  });

  describe('Pure-currency IMPEDI (500/643 — flat-ставка)', () => {
    it('RUB без знаменателя трактуется как specific за штуку, не ad_valorem 500%', () => {
      const product = makeProduct({
        quantity: 3,
        dutyRate: 500,
        dutyRateUnit: 'RUB', // IMPEDI=643 после нормализации
      });
      const result = service.calculate([product], {
        currencyToDoc: { RUB: 1, EUR: 90 },
      });
      // 500 RUB × 3 = 1500, а НЕ 500% × 300 = 1500000
      expect(result.items[0].dutyAmount).toBe(1500);
      expect(result.items[0].dutyBase).toBe('pcs');
    });

    it('EUR без знаменателя (IMPEDI=500) считается как specific за штуку', () => {
      const product = makeProduct({
        quantity: 2,
        dutyRate: 10,
        dutyRateUnit: 'EUR',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(1800); // 10 × 90 × 2
    });
  });

  describe('usedFallback', () => {
    it('false — все товары посчитаны точно (calculationStatus=exact, без estimate)', () => {
      const result = service.calculate([makeProduct()]);
      expect(result.items[0].calculationStatus).toBe('exact');
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
      expect(result.usedFallback).toBe(false);
    });

    it('true — хотя бы один товар оценочный (dutyAmountIsEstimate=true)', () => {
      // Specific duty в м² без dimensions → dutyAmountIsEstimate=true
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product], { eurToDoc: 90 });
      expect(result.items[0].dutyAmountIsEstimate).toBe(true);
      expect(result.usedFallback).toBe(true);
    });

  });
});
