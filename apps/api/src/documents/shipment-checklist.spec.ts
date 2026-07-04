import type { RegulatoryItem, RegulatoryReport } from '../regulatory/interfaces';
import type { MarkingWave } from '../regulatory/curated/marking-waves';
import {
  buildShipmentChecklist,
  type ChecklistItem,
  type ChecklistRowInput,
  TIMING_ORDER,
} from './shipment-checklist';

function makeReport(partial: Partial<RegulatoryReport> = {}): RegulatoryReport {
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

const makeItem = (over: Partial<RegulatoryItem> = {}): RegulatoryItem => ({
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
});

function makeRow(overrides: Partial<ChecklistRowInput> = {}): ChecklistRowInput {
  return {
    tnVedCode: '8482109008',
    notes: [],
    regulatoryReport: null,
    ...overrides,
  };
}

const NOW = new Date('2026-07-05T12:00:00Z');

function build(opts: {
  rows?: ChecklistRowInput[];
  incoterms?: string | null;
  freightCost?: number | null;
  language?: string | null;
  docCountryOfOrigin?: string | null;
  markingWaves?: MarkingWave[];
}) {
  return buildShipmentChecklist({
    rows: opts.rows ?? [],
    docCountryOfOrigin: opts.docCountryOfOrigin ?? '156',
    incoterms: opts.incoterms ?? null,
    freightCost: opts.freightCost ?? null,
    language: opts.language ?? null,
    now: NOW,
    markingWaves: opts.markingWaves,
  });
}

const byTitle = (items: ChecklistItem[], fragment: string): ChecklistItem | undefined =>
  items.find((i) => i.title.includes(fragment));

describe('buildShipmentChecklist', () => {
  describe('базовый пакет и досье', () => {
    it('пустой документ получает базовый пакет, досье и фрахтовый пункт-«проверьте»', () => {
      const { items, warnings } = build({});
      expect(byTitle(items, 'Внешнеторговый контракт')).toMatchObject({
        source: 'base',
        confidence: 'confirmed',
        g44Code: '03011',
        timing: 'before_order',
        scope: 'shipment',
      });
      expect(byTitle(items, 'Счёт-фактура')).toMatchObject({ g44Code: '04021' });
      expect(byTitle(items, 'Упаковочный лист')).toMatchObject({ g44Code: '04131' });
      expect(byTitle(items, 'Транспортный')).toBeDefined();
      expect(byTitle(items, 'УНК')).toMatchObject({ confidence: 'check' });
      expect(byTitle(items, 'РОП')).toMatchObject({ confidence: 'check' });
      // Инкотермс неизвестны → фрахтовые документы с пометкой «проверьте».
      expect(byTitle(items, 'Договор перевозки')).toMatchObject({ confidence: 'check' });
      // Стоимостное досье — всегда, как probable.
      expect(byTitle(items, 'Прайс-лист производителя')).toMatchObject({
        source: 'curated',
        confidence: 'probable',
        timing: 'before_order',
      });
      expect(byTitle(items, 'Экспортная таможенная декларация')).toMatchObject({
        timing: 'before_shipment',
      });
      expect(warnings).toHaveLength(0);
    });

    it('DDP без фрахта: перевозку оплачивает продавец — фрахтовых документов нет', () => {
      const { items } = build({ incoterms: 'DDP' });
      expect(byTitle(items, 'Договор перевозки')).toBeUndefined();
    });

    it('EXW: фрахтовые документы обязательны', () => {
      const { items } = build({ incoterms: 'EXW' });
      expect(byTitle(items, 'Договор перевозки')).toMatchObject({ confidence: 'confirmed' });
    });

    it('заданный фрахт делает фрахтовые документы обязательными даже при CIF', () => {
      const { items } = build({ incoterms: 'CIF', freightCost: 500 });
      expect(byTitle(items, 'Договор перевозки')).toMatchObject({ confidence: 'confirmed' });
    });

    it('CIF/CIP добавляют страховой полис', () => {
      expect(byTitle(build({ incoterms: 'CIF' }).items, 'Страховой полис')).toBeDefined();
      expect(byTitle(build({ incoterms: 'CIP' }).items, 'Страховой полис')).toBeDefined();
      expect(byTitle(build({ incoterms: 'FOB' }).items, 'Страховой полис')).toBeUndefined();
    });
  });

  describe('меры из regulatoryReport (TKS)', () => {
    it('сертификат ТР с exact-совпадением → confirmed, 01401, before_order', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [
              makeItem({ form: 'certificate', regulation: 'ТР ТС 004/2011', matchPrecision: 'exact' }),
            ],
          }),
        }),
      ];
      const item = byTitle(build({ rows }).items, 'Сертификат соответствия ТР ТС 004/2011');
      expect(item).toMatchObject({
        source: 'tks',
        confidence: 'confirmed',
        g44Code: '01401',
        timing: 'before_order',
        scope: 'rows',
        rowNumbers: [1],
      });
      expect(item!.basis).toContain('ТР ТС 004/2011');
    });

    it('декларация с broad-совпадением → check', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [
              makeItem({ form: 'declaration', regulation: 'ТР ТС 020/2011', matchPrecision: 'broad' }),
            ],
          }),
        }),
      ];
      expect(byTitle(build({ rows }).items, 'Декларация о соответствии')).toMatchObject({
        confidence: 'check',
        g44Code: '01402',
      });
    });

    it('нотификация ФСБ — всегда check, даже при exact', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [makeItem({ form: 'notification', matchPrecision: 'exact' })],
          }),
        }),
      ];
      expect(byTitle(build({ rows }).items, 'Нотификация ФСБ')).toMatchObject({
        confidence: 'check',
        g44Code: '10052',
        timing: 'before_order',
      });
    });

    it('СГР получает коды 01206/01411', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [makeItem({ form: 'state_registration' })],
          }),
        }),
      ];
      expect(byTitle(build({ rows }).items, 'СГР')).toMatchObject({ g44Code: '01206/01411' });
    });

    it('одна мера на нескольких строках дедуплицируется с лучшей точностью', () => {
      const cert = (precision: 'exact' | 'broad') =>
        makeRow({
          regulatoryReport: makeReport({
            certifications: [
              makeItem({ form: 'certificate', regulation: 'ТР ТС 004/2011', matchPrecision: precision }),
            ],
          }),
        });
      const items = build({ rows: [cert('broad'), cert('exact')] }).items;
      const certs = items.filter((i) => i.title.includes('ТР ТС 004/2011'));
      expect(certs).toHaveLength(1);
      expect(certs[0]).toMatchObject({ rowNumbers: [1, 2], confidence: 'confirmed' });
    });

    it('лицензия на импорт: import попадает, export отфильтрован', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            licenses: [
              makeItem({ category: 'license_import', authority: 'Минпромторг России' }),
              makeItem({ category: 'license_export' }),
            ],
          }),
        }),
      ];
      const items = build({ rows }).items;
      const licenses = items.filter((i) => i.title.includes('Лицензия'));
      expect(licenses).toHaveLength(1);
      expect(licenses[0]).toMatchObject({
        title: 'Лицензия на импорт (Минпромторг России)',
        g44Code: '01011',
        timing: 'before_order',
      });
    });

    it('утильсбор → 10064, к подаче декларации', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({ utilizationFee: [makeItem({ category: 'utilization' })] }),
        }),
      ];
      expect(byTitle(build({ rows }).items, 'утилизационного сбора')).toMatchObject({
        g44Code: '10064',
        timing: 'for_declaration',
      });
    });

    it('двойное назначение: import → check-пункт, export отфильтрован', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            strategicAndDualUse: [
              makeItem({ category: 'dual_use_import', matchPrecision: 'exact' }),
              makeItem({ category: 'dual_use_export' }),
            ],
          }),
        }),
      ];
      const items = build({ rows }).items.filter((i) => i.title.includes('двойного назначения'));
      expect(items).toHaveLength(1);
      expect(items[0].confidence).toBe('check');
    });
  });

  describe('маркировка: TKS + curated-волны', () => {
    const shoeWave: MarkingWave = {
      group: 'Обувь',
      tnVedPrefixes: ['6403'],
      mandatoryFrom: '2020-07-01',
      basis: 'ПП РФ № 860',
      verifiedAt: '2026-07-05',
    };

    it('TKS-маркировка обогащается датой волны в details', () => {
      const rows = [
        makeRow({
          tnVedCode: '6403911100',
          regulatoryReport: makeReport({ marking: [makeItem({ category: 'marking' })] }),
        }),
      ];
      const items = build({ rows, markingWaves: [shoeWave] }).items;
      const marking = items.filter((i) => i.title.includes('Честный знак'));
      expect(marking).toHaveLength(1);
      expect(marking[0].source).toBe('tks');
      expect(marking[0].details).toContain('обязательна с 01.07.2020');
      expect(marking[0].details).toContain('ПП РФ № 860');
    });

    it('TKS молчит, активная волна → отдельный curated-пункт probable', () => {
      const rows = [makeRow({ tnVedCode: '6403911100', regulatoryReport: makeReport() })];
      const items = build({ rows, markingWaves: [shoeWave] }).items;
      const wave = byTitle(items, 'Маркировка «Честный знак» — Обувь');
      expect(wave).toMatchObject({ source: 'curated', confidence: 'probable', rowNumbers: [1] });
      expect(wave!.details).toContain('справочник');
    });

    it('будущая волна → probable с формулировкой «станет обязательной»', () => {
      const futureWave: MarkingWave = { ...shoeWave, mandatoryFrom: '2026-12-01' };
      const rows = [makeRow({ tnVedCode: '6403911100', regulatoryReport: makeReport() })];
      const wave = byTitle(
        build({ rows, markingWaves: [futureWave] }).items,
        'Маркировка «Честный знак» — Обувь',
      );
      expect(wave!.details).toContain('Станет обязательной с 01.12.2026');
      expect(wave!.confidence).toBe('probable');
    });

    it('partial-волна («из»-позиция) → check', () => {
      const partialWave: MarkingWave = { ...shoeWave, partial: true };
      const rows = [makeRow({ tnVedCode: '6403911100', regulatoryReport: makeReport() })];
      const wave = byTitle(
        build({ rows, markingWaves: [partialWave] }).items,
        'Маркировка «Честный знак» — Обувь',
      );
      expect(wave!.confidence).toBe('check');
    });

    it('строки без волн не создают пунктов маркировки', () => {
      const rows = [makeRow({ tnVedCode: '8482109008', regulatoryReport: makeReport() })];
      const items = build({ rows, markingWaves: [shoeWave] }).items;
      expect(items.some((i) => i.title.includes('Честный знак'))).toBe(false);
    });
  });

  describe('антидемпинг и страновые запреты', () => {
    it('нота antidumping → сертификат происхождения, confirmed, 06014', () => {
      const rows = [
        makeRow({
          notes: [{ stage: 'calculate', severity: 'warning', message: 'антидемпинг', field: 'antidumping' }],
        }),
        makeRow({}),
        makeRow({
          notes: [{ stage: 'calculate', severity: 'warning', message: 'компенсац.', field: 'compensatory' }],
        }),
      ];
      const item = byTitle(build({ rows }).items, 'Сертификат о происхождении');
      expect(item).toMatchObject({
        source: 'curated',
        confidence: 'confirmed',
        g44Code: '06014',
        timing: 'before_shipment',
        rowNumbers: [1, 3],
      });
    });

    it('запрет ввоза попадает в warnings при совпадении страны строки', () => {
      const ban = makeItem({
        category: 'country_import_ban',
        title: 'Запрет ввоза',
        countryCode: '156',
        countryName: 'КИТАЙ',
      });
      const rows = [makeRow({ regulatoryReport: makeReport({ countryRestrictions: [ban] }) })];
      expect(build({ rows, docCountryOfOrigin: '156' }).warnings[0]).toContain('КИТАЙ');
      // Страна строки перекрывает страну документа и не совпадает с запретом.
      const rowsOther = [
        makeRow({
          countryOfOrigin: '792',
          regulatoryReport: makeReport({ countryRestrictions: [ban] }),
        }),
      ];
      expect(build({ rows: rowsOther, docCountryOfOrigin: '156' }).warnings).toHaveLength(0);
    });
  });

  describe('локализация и сортировка', () => {
    it('language=ru → titleLocalized везде null', () => {
      const { items } = build({ language: 'ru' });
      expect(items.every((i) => i.titleLocalized === null)).toBe(true);
    });

    it.each(['en', 'zh'] as const)('language=%s: все статичные пункты переведены', (lang) => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [
              makeItem({ form: 'certificate', regulation: 'ТР ТС 004/2011' }),
              makeItem({ form: 'notification' }),
            ],
            utilizationFee: [makeItem({ category: 'utilization' })],
            marking: [makeItem({ category: 'marking' })],
          }),
        }),
      ];
      const { items } = build({ rows, language: lang, incoterms: 'CIF', freightCost: 100 });
      const missing = items.filter((i) => !i.titleLocalized).map((i) => i.title);
      expect(missing).toEqual([]);
    });

    it('перевод шаблона содержит идентификатор регламента', () => {
      const rows = [
        makeRow({
          regulatoryReport: makeReport({
            certifications: [makeItem({ form: 'certificate', regulation: 'ТР ТС 004/2011' })],
          }),
        }),
      ];
      const item = byTitle(build({ rows, language: 'en' }).items, 'ТР ТС 004/2011');
      expect(item!.titleLocalized).toBe('Certificate of conformity ТР ТС 004/2011');
    });

    it('пункты отсортированы по timing, внутри — по уверенности', () => {
      const rows = [
        makeRow({
          tnVedCode: '6403911100',
          regulatoryReport: makeReport({
            certifications: [makeItem({ form: 'declaration', regulation: 'ТР ТС 017/2011' })],
            utilizationFee: [makeItem({ category: 'utilization' })],
          }),
        }),
      ];
      const { items } = build({ rows });
      const timings = items.map((i) => TIMING_ORDER.indexOf(i.timing));
      expect([...timings].sort((a, b) => a - b)).toEqual(timings);
      // Внутри одной timing-группы confirmed идёт раньше check.
      for (let i = 1; i < items.length; i++) {
        if (items[i - 1].timing === items[i].timing) {
          const rank = { confirmed: 0, probable: 1, check: 2 };
          expect(rank[items[i - 1].confidence]).toBeLessThanOrEqual(rank[items[i].confidence]);
        }
      }
    });
  });
});
