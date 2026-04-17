import { CalculatorService, formatDutyRate, normalizePer } from './calculator.service';
import type { CalculatorInput, CommissionConfig, CalculatedProduct } from './calculator.service';
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

const ZERO_COMMISSION: CommissionConfig = { pricePercent: 0, weightRate: 0, fixedFee: 0 };

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
      const result = service.calculate([makeProduct()], ZERO_COMMISSION);

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
        ZERO_COMMISSION,
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
        ZERO_COMMISSION,
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 1 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 10 });
      expect(result.items[0].dutyAmount).toBeCloseTo(204);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
      expect(result.items[0].dutyBase).toBe('pair');
    });

    it('IMP с IMPEDI="%" остаётся адвалорным', () => {
      const product = makeProduct({ dutyRate: 10, dutyRateUnit: '%' });
      const result = service.calculate([product], ZERO_COMMISSION);
      expect(result.items[0].dutyAmount).toBe(100);
    });

    it('рассчитывает specific пошлину в EUR/1000шт (ОКЕИ 798)', () => {
      const product = makeProduct({ quantity: 500, dutyRate: 6, dutyRateUnit: 'EUR/1000шт' });
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 100 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 100 });
      expect(result.items[0].dutyAmount).toBe(1000);
      expect(result.items[0].dutyBase).toBe('t');
    });

    it('specific пошлина в EUR/см³ без dimensions → estimate+blocker', () => {
      const product = makeProduct({ dutyRate: 0.5, dutyRateUnit: 'EUR/см³' });
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
      expect(result.items[0].dutyAmount).toBe(450000);
      expect(result.items[0].dutyAmountIsEstimate).toBe(false);
    });

    it('dual-specific (IMP+IMP2 обе specific) → применяет IMP и пушит blocker', () => {
      // Fallback не умеет совмещать две specific-составляющие, применяет только IMP.
      const product = makeProduct({
        quantity: 10,
        dutyRate: 0.5,
        dutyRateUnit: 'EUR/пар',
        dutySign: '>',
        dutyMin: 2,
        dutyMinUnit: 'EUR/кг',
      });
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
      const item = result.items[0];
      expect(item.dutyAmount).toBe(450);
      const blocker = item.notes.find(
        (n) => n.severity === 'blocker' && n.field === 'duty' && /двумя специфическими/.test(n.message),
      );
      expect(blocker).toBeDefined();
      expect(item.calculationStatus).toBe('needs_info');
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION, { eurToDoc: 90 });
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
      const result = service.calculate([product], ZERO_COMMISSION);
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
      const result = service.calculate([product], ZERO_COMMISSION);
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
      const result = service.calculate([product], ZERO_COMMISSION);
      // duty = 5% + 3% = 80
      expect(result.items[0].dutyAmount).toBe(80);
    });
  });

  describe('Комиссия за логистику', () => {
    it('рассчитывает комиссию: pricePercent + weightRate + fixedFee', () => {
      const commission: CommissionConfig = {
        pricePercent: 5,
        weightRate: 10,
        fixedFee: 500,
      };
      const product = makeProduct(); // totalPrice=1000, weight=2, qty=10
      const result = service.calculate([product], commission);
      // 1000*5/100 + 2*10*10 + 500 = 50 + 200 + 500 = 750
      expect(result.items[0].logisticsCommission).toBe(750);
    });

    it('нулевая комиссия при нулевых настройках', () => {
      const result = service.calculate([makeProduct()], ZERO_COMMISSION);
      expect(result.items[0].logisticsCommission).toBe(0);
    });
  });

  describe('VerificationStatus', () => {
    it('exact при matched=true и confidence >= дефолтного порога 0.8', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.8 })],
        ZERO_COMMISSION,
      );
      expect(result.items[0].verificationStatus).toBe('exact');
    });

    it('review при confidence < дефолтного порога 0.8', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.79 })],
        ZERO_COMMISSION,
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });

    it('review при matched=false', () => {
      const result = service.calculate(
        [makeProduct({ matched: false, matchConfidence: 0.95 })],
        ZERO_COMMISSION,
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });

    it('использует переданный порог вместо дефолтного', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.75 })],
        ZERO_COMMISSION,
        { confidenceThreshold: 0.7 },
      );
      expect(result.items[0].verificationStatus).toBe('exact');
    });

    it('review при confidence ниже переданного порога', () => {
      const result = service.calculate(
        [makeProduct({ matched: true, matchConfidence: 0.85 })],
        ZERO_COMMISSION,
        { confidenceThreshold: 0.9 },
      );
      expect(result.items[0].verificationStatus).toBe('review');
    });
  });

  describe('CalculationStatus', () => {
    it('exact без заметок', () => {
      const result = service.calculate([makeProduct()], ZERO_COMMISSION);
      expect(result.items[0].calculationStatus).toBe('exact');
    });

    it('needs_info при blocker (нет dimensions)', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product], ZERO_COMMISSION);
      expect(result.items[0].calculationStatus).toBe('needs_info');
    });

    it('partial при warning в notes', () => {
      const product = makeProduct({
        notes: [{ stage: 'classify', severity: 'warning', message: 'low confidence' }],
      });
      const result = service.calculate([product], ZERO_COMMISSION);
      expect(result.items[0].calculationStatus).toBe('partial');
    });

    it('error при blocker с field=code', () => {
      const product = makeProduct({
        notes: [{ stage: 'classify', severity: 'blocker', field: 'code', message: 'not found' }],
      });
      const result = service.calculate([product], ZERO_COMMISSION);
      expect(result.items[0].calculationStatus).toBe('error');
    });
  });

  describe('Summarize (итоги по нескольким товарам)', () => {
    it('суммирует все позиции', () => {
      const products = [
        makeProduct({ price: 100, quantity: 10 }), // totalPrice=1000
        makeProduct({ price: 200, quantity: 5 }),  // totalPrice=1000
      ];
      const result = service.calculate(products, ZERO_COMMISSION);
      expect(result.items).toHaveLength(2);
      expect(result.totalDuty).toBe(result.items[0].dutyAmount + result.items[1].dutyAmount);
      expect(result.totalVat).toBe(result.items[0].vatAmount + result.items[1].vatAmount);
      expect(result.grandTotal).toBe(result.items[0].totalCost + result.items[1].totalCost);
    });

    it('пустой список → нулевые итоги', () => {
      const result = service.calculate([], ZERO_COMMISSION);
      expect(result.items).toHaveLength(0);
      expect(result.grandTotal).toBe(0);
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
      const result = service.calculate([product], ZERO_COMMISSION);
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
      const result = service.calculate([product], ZERO_COMMISSION);
      expect(result.items[0].notes).toContainEqual(inputNote);
    });

    it('blocker notes добавляются калькулятором при estimate', () => {
      const product = makeProduct({
        dutyRate: 0,
        dutyMin: 0.38,
        dutyMinUnit: 'м2',
      });
      const result = service.calculate([product], ZERO_COMMISSION);
      const blockerNotes = result.items[0].notes.filter(
        (n) => n.stage === 'calculate' && n.severity === 'blocker',
      );
      expect(blockerNotes.length).toBeGreaterThan(0);
    });
  });
});
