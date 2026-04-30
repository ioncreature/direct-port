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

  it('не показывает юридические подробности (основание, срок действия)', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        form: 'declaration',
        documentRef: { number: '123-Р', date: '2024-03-15' },
        validFrom: '2024-04-01',
        validTo: '2030-12-31',
      }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).not.toContain('Основание');
    expect(out).not.toContain('Действует с');
    expect(out).not.toContain('По 31.12.2030');
  });

  it('не выводит блоки маркировки, страновых запретов и «прочее»', () => {
    const report = makeReport([
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
      makeItem({ category: 'country_export_ban', countryName: 'СОЕДИНЕННОЕ КОРОЛЕВСТВО' }),
      makeItem({ category: 'other', title: 'Прочие меры регулирования' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe('');
  });

  it('выводит только разрешённые группы, скрытые игнорирует', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'marking', validFrom: '2026-05-01' }),
      makeItem({ category: 'other', title: 'Прочее' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      'Сертификация / декларирование:\n• ТР ТС 020/2011 — декларация о соответствии',
    );
  });

  it('утильсбор форматирует ставку с разделителями', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toContain('Утильсбор 32 874 ₽ за единицу');
  });

  it('broad-precision показывается коротким маркером в заголовке', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        form: 'declaration',
        matchPrecision: 'broad',
      }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toContain('ТР ТС 020/2011 — декларация о соответствии ⚠ широкое применение');
    expect(out).not.toContain('Применимость: широкая');
  });

  it('дедуплицирует меры с разными documentRef/validFrom как одну', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 007/2011',
        form: 'declaration',
        documentRef: { number: '28', date: '2013-03-05' },
        validFrom: '2013-04-05',
      }),
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 007/2011',
        form: 'declaration',
        documentRef: { number: '4114', date: '2024-09-10' },
        validFrom: '2022-10-03',
      }),
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 007/2011',
        form: 'declaration',
        documentRef: { number: '28', date: '2013-03-05' },
        validFrom: '2020-01-26',
      }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      'Сертификация / декларирование:\n• ТР ТС 007/2011 — декларация о соответствии',
    );
  });

  it('дедупликация игнорирует precision: при наличии exact и broad оставляет одну (exact)', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        form: 'declaration',
        matchPrecision: 'exact',
      }),
      makeItem({
        category: 'certification',
        regulation: 'ТР ТС 020/2011',
        form: 'declaration',
        matchPrecision: 'broad',
      }),
    ]);
    const out = formatRegulatoryReportLong(report);
    expect(out).toBe(
      'Сертификация / декларирование:\n• ТР ТС 020/2011 — декларация о соответствии',
    );
  });

  it('сворачивает 2+ generic-записей без regulation в одну строку', () => {
    const report = makeReport([
      makeItem({ category: 'certification', authority: 'Минпромторг А' }),
      makeItem({ category: 'certification', authority: 'Минпромторг Б' }),
      makeItem({ category: 'certification', authority: 'Минпромторг В' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      'Сертификация / декларирование:\n+ 3 записей без явного регламента',
    );
  });

  it('одну generic-запись оставляет полноценным блоком', () => {
    const report = makeReport([
      makeItem({
        category: 'certification',
        title: 'Подтверждение соответствия',
        authority: 'Минпромторг России',
      }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Сертификация / декларирование:',
        '• Подтверждение соответствия',
        '   Регулятор: Минпромторг России',
      ].join('\n'),
    );
  });

  it('смешивает regulation-меры и generic-сворачивание в одной группе', () => {
    const report = makeReport([
      makeItem({ category: 'certification', regulation: 'ТР ТС 019/2011', form: 'declaration' }),
      makeItem({ category: 'certification', authority: 'Минпромторг А' }),
      makeItem({ category: 'certification', authority: 'Минпромторг Б' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Сертификация / декларирование:',
        '• ТР ТС 019/2011 — декларация о соответствии',
        '+ 2 записей без явного регламента',
      ].join('\n'),
    );
  });

  it('утильсбор со ставкой не считается generic, без ставки — считается', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 5162, max: null, unit: null } }),
      makeItem({ category: 'utilization', authority: 'Росприроднадзор' }),
      makeItem({ category: 'utilization', authority: 'Росприроднадзор', regulationTitle: 'Иное' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Утилизационный / экологический сбор:',
        '• Утильсбор 5 162 ₽ за единицу',
        '+ 2 записей без явного регламента',
      ].join('\n'),
    );
  });

  it('собирает несколько групп через пустую строку, в фиксированном порядке', () => {
    const report = makeReport([
      makeItem({ category: 'utilization', values: { min: 32874, max: null, unit: null } }),
      makeItem({ category: 'license_import' }),
      makeItem({ category: 'certification', regulation: 'ТР ТС 020/2011', form: 'declaration' }),
      makeItem({ category: 'traceability' }),
    ]);
    expect(formatRegulatoryReportLong(report)).toBe(
      [
        'Сертификация / декларирование:',
        '• ТР ТС 020/2011 — декларация о соответствии',
        '',
        'Лицензии:',
        '• Лицензия',
        '',
        'Прослеживаемость:',
        '• Прослеживаемость',
        '',
        'Утилизационный / экологический сбор:',
        '• Утильсбор 32 874 ₽ за единицу',
      ].join('\n'),
    );
  });
});
