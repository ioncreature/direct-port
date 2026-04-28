import type { RegulatoryItem, RegulatoryReport } from './interfaces';
import { formatRegulatoryReportShort } from './regulatory-format';

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
    matchPrecision: 'broad',
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

describe('formatRegulatoryReportShort', () => {
  it('возвращает пустую строку для пустого отчёта', () => {
    expect(formatRegulatoryReportShort(makeReport([]))).toBe('');
    expect(formatRegulatoryReportShort(null)).toBe('');
    expect(formatRegulatoryReportShort(undefined)).toBe('');
  });

  it('форматирует ТР ТС с короткой формой', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe('ТР ТС 020/2011 декл.');
  });

  it('дедуплицирует одинаковые записи (один и тот же ТР повторяется в списке)', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe('ТР ТС 020/2011 декл.');
  });

  it('форматирует маркировку с датой вступления в силу', () => {
    const report = makeReport([
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe('Маркировка с 01.05.2026');
  });

  it('форматирует утильсбор со ставкой', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe('Утильсбор 32874 ₽');
  });

  it('форматирует страновой запрет с названием страны', () => {
    const report = makeReport([
      makeItem({ category: 'country_import_ban', countryName: 'ЯПОНИЯ', countryCode: '392' }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe('Запрет: ЯПОНИЯ');
  });

  it('собирает несколько категорий через `;`', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'license_import' }),
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
    ]);
    expect(formatRegulatoryReportShort(report)).toBe(
      'ТР ТС 020/2011 декл.; Лицензия; Маркировка с 01.05.2026; Утильсбор 32874 ₽',
    );
  });
});
