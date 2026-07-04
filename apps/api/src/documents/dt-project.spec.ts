import { buildDtProject, type DtRowInput } from './dt-project';
import type { RegulatoryReport } from '../regulatory/interfaces';

function makeRow(overrides: Partial<DtRowInput> = {}): DtRowInput {
  return {
    description: 'Товар',
    quantity: 10,
    weight: 1,
    tnVedCode: '8516101000',
    totalPrice: 1000,
    freightShare: 0,
    dutyAmount: 100,
    vatAmount: 220,
    exciseAmount: 0,
    totalPriceRub: 90000,
    freightShareRub: 0,
    dutyAmountRub: 9000,
    vatAmountRub: 19800,
    exciseAmountRub: 0,
    calculationStatus: 'exact',
    notes: [],
    ...overrides,
  };
}

function makeReport(partial: Partial<RegulatoryReport>): RegulatoryReport {
  return {
    certifications: [],
    permits: [],
    licenses: [],
    marking: [],
    traceability: [],
    utilizationFee: [],
    strategicAndDualUse: [],
    countryRestrictions: [],
    other: [],
    totalCount: 1,
    ...partial,
  };
}

const makeItem = (over: Record<string, unknown>) =>
  ({
    id: 'x',
    category: 'certification',
    priznak: 11,
    title: 'Мера',
    summary: '',
    regulation: null,
    regulationTitle: null,
    form: 'unknown',
    authority: null,
    documentRef: null,
    validFrom: null,
    validTo: null,
    matchPrecision: 'exact',
    codeRange: { min: '85', max: null },
    countryCode: null,
    countryName: null,
    values: { min: null, max: null, unit: null },
    rawNote: '',
    ...over,
  }) as RegulatoryReport['certifications'][number];

const DEFAULTS = {
  docCountryOfOrigin: '156',
  currency: 'CNY',
  exchangeRates: { USD: 90, CNY: 12 } as Record<string, number>,
};

describe('buildDtProject', () => {
  describe('группировка в товары ДТ', () => {
    it('строки одного кода и страны сливаются в один товар', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({ description: 'Чайник белый' }),
          makeRow({ description: 'Чайник чёрный' }),
          makeRow({ tnVedCode: '6402999100' }),
        ],
      });

      expect(project.goods).toHaveLength(2);
      expect(project.goods[0].tnVedCode).toBe('8516101000');
      expect(project.goods[0].rowNumbers).toEqual([1, 2]);
      expect(project.goods[1].tnVedCode).toBe('6402999100');
      expect(project.goods.map((g) => g.goodNumber)).toEqual([1, 2]);
    });

    it('строки одного кода, но разных стран — разные товары ДТ', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow(), makeRow({ countryOfOrigin: '704' })],
      });

      expect(project.goods).toHaveLength(2);
      expect(project.goods[0].countryCode).toBe('156');
      expect(project.goods[0].countryName).toBe('КИТАЙ');
      expect(project.goods[1].countryCode).toBe('704');
      expect(project.goods[1].countryName).toBe('ВЬЕТНАМ');
    });

    it('строки без кода уходят в unassignedRows с предупреждением', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow(), makeRow({ tnVedCode: '' })],
      });

      expect(project.goods).toHaveLength(1);
      expect(project.unassignedRows).toEqual([2]);
      expect(project.warnings[0]).toContain('Строки 2 без кода ТН ВЭД');
    });
  });

  describe('веса (графы 35/38)', () => {
    it('нетто/брутто суммируются по строкам с округлением до 3 знаков', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({ weight: 0.3333, weightGross: 0.4, quantity: 3 }),
          makeRow({ weight: 1, weightGross: 1.2, quantity: 2 }),
        ],
      });

      const good = project.goods[0];
      // 0.3333×3 + 1×2 = 2.9999 → 3 знака → 3.000
      expect(good.netWeightKg).toBe(3);
      expect(good.grossWeightKg).toBeCloseTo(3.6, 4);
      expect(good.grossIsEstimated).toBe(false);
    });

    it('строка без брутто даёт оценку по нетто + предупреждение', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow({ weight: 2, quantity: 5 })],
      });

      const good = project.goods[0];
      expect(good.grossWeightKg).toBe(10);
      expect(good.grossIsEstimated).toBe(true);
      expect(good.warnings.some((w) => w.includes('брутто оценён по нетто'))).toBe(true);
    });
  });

  describe('черновик графы 31', () => {
    it('уникальные наименования + слитые атрибуты', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({
            description: 'Чайник электрический',
            attributes: { material: 'сталь', brand: 'Acme', article: 'A-1' },
          }),
          makeRow({
            description: 'Чайник электрический',
            attributes: { material: 'сталь', brand: 'Acme', article: 'A-2' },
          }),
        ],
      });

      const draft = project.goods[0].descriptionDraft;
      expect(draft).toContain('Чайник электрический');
      expect(draft.match(/Чайник электрический/g)).toHaveLength(1);
      expect(draft).toContain('Товарный знак: Acme');
      expect(draft).toContain('Артикул: A-1, A-2');
      expect(draft).toContain('Материал: сталь');
    });
  });

  describe('стоимости (графы 42/45/46) и ИТС', () => {
    it('инвойсная и таможенная стоимость в валюте, ₽ и USD', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({
            totalPrice: 1000,
            freightShare: 100,
            totalPriceRub: 12000,
            freightShareRub: 1200,
            weight: 1,
            quantity: 10,
          }),
        ],
      });

      const good = project.goods[0];
      expect(good.invoiceValue).toBe(1000);
      expect(good.customsValue).toBe(1100);
      expect(good.customsValueRub).toBe(13200);
      // 13200 ₽ / 90 ₽ за $ = 146.67 $
      expect(good.statisticalValueUsd).toBeCloseTo(146.67, 2);
      // ИТС: 146.67 $ / 10 кг нетто
      expect(good.itcUsdPerKg).toBeCloseTo(14.67, 2);
    });

    it('USD-документ: статистическая стоимость = таможенной без конвертации', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        currency: 'USD',
        exchangeRates: null,
        rows: [makeRow({ totalPrice: 500, freightShare: 50, totalPriceRub: undefined })],
      });

      expect(project.goods[0].statisticalValueUsd).toBe(550);
    });

    it('RUB-документ: рублёвые значения берутся из основных полей', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        currency: 'RUB',
        exchangeRates: { USD: 90 },
        rows: [
          makeRow({
            totalPrice: 90000,
            freightShare: 9000,
            dutyAmount: 9900,
            totalPriceRub: undefined,
            dutyAmountRub: undefined,
          }),
        ],
      });

      const good = project.goods[0];
      expect(good.customsValueRub).toBe(99000);
      expect(good.dutyRub).toBe(9900);
      expect(good.statisticalValueUsd).toBeCloseTo(1100, 2);
    });

    it('без RUB-конвертации (legacy/FAILED-курс) — рублёвые поля и USD null', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        exchangeRates: null,
        rows: [
          makeRow({
            totalPriceRub: undefined,
            freightShareRub: undefined,
            dutyAmountRub: undefined,
            vatAmountRub: undefined,
            exciseAmountRub: undefined,
          }),
        ],
      });

      const good = project.goods[0];
      expect(good.customsValueRub).toBeNull();
      expect(good.statisticalValueUsd).toBeNull();
      expect(good.itcUsdPerKg).toBeNull();
      expect(project.totals.needsDts1).toBeNull();
    });
  });

  describe('графа 41 (доп. единица)', () => {
    it('суммирует количество, когда оно есть у всех строк', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({ supplementaryUnit: 'пар', supplementaryQuantity: 10 }),
          makeRow({ supplementaryUnit: 'пар', supplementaryQuantity: 14 }),
        ],
      });

      expect(project.goods[0].supplementaryUnit).toBe('пар');
      expect(project.goods[0].supplementaryQuantity).toBe(24);
    });

    it('частичные данные → null + предупреждение', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({ supplementaryUnit: 'л', supplementaryQuantity: 5 }),
          makeRow({ supplementaryUnit: 'л', supplementaryQuantity: null }),
        ],
      });

      const good = project.goods[0];
      expect(good.supplementaryQuantity).toBeNull();
      expect(good.warnings.some((w) => w.includes('графы 41'))).toBe(true);
    });
  });

  describe('итоги и ДТС-порог', () => {
    it('needsDts1=true и предупреждение при партии дороже $10 000', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow({ totalPriceRub: 1_000_000 })],
      });

      // 1 000 000 ₽ / 90 = $11 111
      expect(project.totals.statisticalValueUsd).toBeCloseTo(11111.11, 1);
      expect(project.totals.needsDts1).toBe(true);
      expect(project.warnings.some((w) => w.includes('ДТС-1'))).toBe(true);
    });

    it('needsDts1=false для дешёвой партии', () => {
      const project = buildDtProject({ ...DEFAULTS, rows: [makeRow()] });
      expect(project.totals.needsDts1).toBe(false);
    });
  });

  describe('графа 44 и предупреждения из regulatoryReport', () => {
    it('коды документов: 01401/01402/09999', () => {
      const report = makeReport({
        certifications: [
          makeItem({ form: 'certificate', regulation: 'ТР ТС 010/2011' }),
          makeItem({ form: 'declaration', regulation: 'ТР ТС 020/2011' }),
        ],
        utilizationFee: [makeItem({ category: 'utilization', priznak: 29, form: 'fee' })],
      });
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow({ regulatoryReport: report })],
      });

      const hints = project.goods[0].documentHints;
      expect(hints).toContain('01401 — сертификат соответствия ТР ТС 010/2011');
      expect(hints).toContain('01402 — декларация о соответствии ТР ТС 020/2011');
      expect(hints).toContain('09999 — расчёт утилизационного сбора');
    });

    it('маркировка «Честный знак» → предупреждение про графу 31', () => {
      const report = makeReport({
        marking: [makeItem({ category: 'marking', priznak: 28 })],
      });
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow({ regulatoryReport: report })],
      });

      expect(
        project.goods[0].warnings.some((w) => w.includes('Честный знак')),
      ).toBe(true);
    });

    it('запрет ввоза по стране товара попадает в предупреждения, чужая страна — нет', () => {
      const report = makeReport({
        countryRestrictions: [
          makeItem({
            category: 'country_import_ban',
            priznak: 35,
            countryCode: '156',
            countryName: 'КИТАЙ',
            title: 'Запрет ввоза',
          }),
          makeItem({
            category: 'country_import_ban',
            priznak: 35,
            countryCode: '840',
            countryName: 'США',
            title: 'Запрет ввоза',
          }),
        ],
      });
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [makeRow({ regulatoryReport: report })],
      });

      const warnings = project.goods[0].warnings.filter((w) => w.includes('Запрет'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('КИТАЙ');
    });

    it('антидемпинговая нота на строке → предупреждение про сертификат происхождения', () => {
      const project = buildDtProject({
        ...DEFAULTS,
        rows: [
          makeRow({
            notes: [
              {
                stage: 'calculate',
                severity: 'warning',
                field: 'antidumping',
                message: 'Применена антидемпинговая пошлина',
              },
            ],
          }),
        ],
      });

      expect(
        project.goods[0].warnings.some((w) => w.includes('сертификатом')),
      ).toBe(true);
    });
  });
});
