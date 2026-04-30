import type { RegulatoryItem, RegulatoryReport } from './interfaces';
import { formatRegulatoryReportLong } from './regulatory-format';

function makeItem(overrides: Partial<RegulatoryItem>): RegulatoryItem {
  return {
    id: 'id',
    category: 'certification',
    priznak: 11,
    title: '',
    summary: '',
    regulation: null,
    regulationTitle: null,
    form: 'unknown',
    authority: null,
    documentRef: null,
    validFrom: null,
    validTo: null,
    matchPrecision: 'exact',
    codeRange: { min: '', max: null },
    countryCode: null,
    countryName: null,
    values: { min: null, max: null, unit: null },
    rawNote: '',
    ...overrides,
  };
}

function makeReport(items: RegulatoryItem[]): RegulatoryReport {
  return {
    certifications: items.filter((i) => i.category === 'certification'),
    permits: items.filter((i) => i.category === 'permit_import' || i.category === 'permit_export'),
    licenses: items.filter((i) => i.category === 'license_import' || i.category === 'license_export'),
    marking: items.filter((i) => i.category === 'marking'),
    traceability: items.filter((i) => i.category === 'traceability'),
    utilizationFee: items.filter((i) => i.category === 'utilization'),
    strategicAndDualUse: items.filter(
      (i) => i.category === 'strategic' || i.category === 'dual_use_import' || i.category === 'dual_use_export',
    ),
    countryRestrictions: items.filter(
      (i) => i.category === 'country_import_ban' || i.category === 'country_export_ban',
    ),
    other: items.filter((i) => i.category === 'other'),
    totalCount: items.length,
  };
}

describe('formatRegulatoryReportLong', () => {
  it('возвращает пустую строку для пустого отчёта', () => {
    expect(formatRegulatoryReportLong(makeReport([]))).toBe('');
    expect(formatRegulatoryReportLong(null)).toBe('');
    expect(formatRegulatoryReportLong(undefined)).toBe('');
  });

  it('форматирует ТР ТС с длинной формой и заголовком группы', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      'Сертификация / декларирование:\n• ТР ТС 020/2011 — декларация о соответствии',
    );
  });

  it('добавляет regulationTitle и регулятора отдельными строками', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        regulationTitle: 'Электромагнитная совместимость технических средств',
        form: 'declaration',
        authority: 'Минпромторг России',
      }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Сертификация / декларирование:',
        '• ТР ТС 020/2011 — декларация о соответствии',
        '   Электромагнитная совместимость технических средств',
        '   Регулятор: Минпромторг России',
      ].join('\n'),
    );
  });

  it('включает основание (документ + дата) и срок действия', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 010/2011',
        form: 'certificate',
        documentRef: { number: '123-Р', date: '2024-03-15' },
        validFrom: '2024-04-01',
        validTo: '2030-12-31',
      }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toContain('Основание: № 123-Р от 15.03.2024');
    expect(out).toContain('Действует с 01.04.2024');
    expect(out).toContain('По 31.12.2030');
  });

  it('маркировка: дата вступления в заголовке, не дублируется в подробностях', () => {
    const report = makeReport([
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toBe('Маркировка:\n• Маркировка с 01.05.2026');
    expect(out).not.toContain('Действует с');
  });

  it('утильсбор форматирует ставку с разделителями', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toContain('Утильсбор 32 874 ₽ за единицу');
  });

  it('страновой запрет: ввоз и вывоз различаются в заголовке', () => {
    const importBan = makeReport([
      makeItem({ category: 'country_import_ban', countryName: 'ЯПОНИЯ', countryCode: '392' }),
    ]);
    expect(formatRegulatoryReportLong(importBan)).toContain('Запрет ввоза: ЯПОНИЯ');

    const exportBan = makeReport([
      makeItem({ category: 'country_export_ban', countryName: 'США', countryCode: '840' }),
    ]);
    expect(formatRegulatoryReportLong(exportBan)).toContain('Запрет вывоза: США');
  });

  it('помечает меры с broad-применимостью', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        form: 'declaration',
        matchPrecision: 'broad',
      }),
    ]);
    expect(formatRegulatoryReportLong(report)).toContain(
      'Применимость: широкая — проверьте по конкретному коду товара',
    );
  });

  it('дедуплицирует одинаковые блоки внутри группы', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      'Сертификация / декларирование:\n• ТР ТС 020/2011 — декларация о соответствии',
    );
  });

  it('собирает несколько групп через пустую строку, в фиксированном порядке', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
      makeItem({ category: 'license_import' }),
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Сертификация / декларирование:',
        '• ТР ТС 020/2011 — декларация о соответствии',
        '',
        'Лицензии:',
        '• Лицензия',
        '',
        'Маркировка:',
        '• Маркировка с 01.05.2026',
        '',
        'Утилизационный / экологический сбор:',
        '• Утильсбор 32 874 ₽ за единицу',
      ].join('\n'),
    );
  });
});
