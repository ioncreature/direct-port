import type { TnvedCode, TnvedallEntry } from '@direct-port/tks-api';
import type { CountriesService } from '../countries/countries.service';
import { RegulatoryRequirementsService } from './regulatory-requirements.service';

function makeTnvedCode(
  code: string,
  tnvedall: Record<string, TnvedallEntry[]>,
): TnvedCode {
  return { CODE: code, KR_NAIM: 'Описание', TNVED: {}, TNVEDALL: tnvedall };
}

function entry(partial: Partial<TnvedallEntry>): TnvedallEntry {
  return {
    PRIZNAK: undefined,
    NOTE: '',
    DOC_N: null,
    DOC_D: null,
    CODEMIN: '8517130000',
    CODEMAX: null,
    DBEGIN: null,
    DEND: null,
    CU: null,
    MIN: null,
    MAX: null,
    MIN2: null,
    SIGN: null,
    SIGN2: null,
    PREF: null,
    PRIM: null,
    TYPEMIN: null,
    TYPEMAX: null,
    TYPEMIN2: null,
    ...partial,
  };
}

function makeService(): RegulatoryRequirementsService {
  const countriesService = {
    findByCode: jest.fn(async (code: string | null) => {
      if (code === '124') return { code: '124', nameRu: 'КАНАДА' } as never;
      if (code === '392') return { code: '392', nameRu: 'ЯПОНИЯ' } as never;
      return null;
    }),
  } as unknown as CountriesService;
  return new RegulatoryRequirementsService(countriesService);
}

describe('RegulatoryRequirementsService', () => {
  it('возвращает пустой отчёт для кода без TNVEDALL', async () => {
    const service = makeService();
    const report = await service.buildReport({
      CODE: '0000000000',
      KR_NAIM: 'Тест',
      TNVED: {},
    } as TnvedCode);
    expect(report.totalCount).toBe(0);
    expect(report.certifications).toHaveLength(0);
  });

  it('извлекает сертификацию по ТР ТС с авторитетом и периодом', async () => {
    const service = makeService();
    const tnved = makeTnvedCode('8517130000', {
      '11': [
        entry({
          PRIZNAK: 11,
          NOTE: 'Возможно товар подлежат подтверждению соответствия требованиям технического регламента ТС "О безопасности оборудования для работы во взрывоопасных средах" (ТР ТС 012/2011). Решение Комиссии ТС от 18.10.11г. N 825. Минпромторг России.',
          DOC_N: '825',
          DOC_D: '2011-10-18',
          DBEGIN: '2015-03-15',
          CODEMIN: '84',
          CODEMAX: '90',
        }),
      ],
    });

    const report = await service.buildReport(tnved);
    expect(report.certifications).toHaveLength(1);
    const item = report.certifications[0];
    expect(item.regulation).toBe('ТР ТС 012/2011');
    expect(item.regulationTitle).toBe('О безопасности оборудования для работы во взрывоопасных средах');
    expect(item.authority).toBe('Минпромторг России');
    expect(item.documentRef).toEqual({ number: '825', date: '2011-10-18' });
    expect(item.validFrom).toBe('2015-03-15');
    expect(item.title).toContain('ТР ТС 012/2011');
    expect(item.summary).toContain('ТР ТС 012/2011');
    expect(item.summary).toContain('Минпромторг России');
    expect(item.summary).toContain('18.10.2011');
    expect(item.matchPrecision).toBe('broad');
  });

  it('маркирует exact для CODEMIN==10-знакам', async () => {
    const service = makeService();
    const tnved = makeTnvedCode('8517130000', {
      '28': [
        entry({
          PRIZNAK: 28,
          NOTE: 'Маркировка средствами идентификации. ПП РФ N 1954.',
          DOC_N: '1954',
          DOC_D: '2025-11-28',
          DBEGIN: '2026-03-01',
          CODEMIN: '8517130000',
        }),
      ],
    });
    const report = await service.buildReport(tnved);
    expect(report.marking).toHaveLength(1);
    expect(report.marking[0].matchPrecision).toBe('exact');
    expect(report.marking[0].form).toBe('unknown');
  });

  it('собирает запрет по странам с резолвом названия', async () => {
    const service = makeService();
    const tnved = makeTnvedCode('8517130000', {
      '35': [
        entry({
          PRIZNAK: 35,
          NOTE: 'Санкции Канады в отношении России',
          DOC_N: 'САНК_24',
          DOC_D: '2023-11-15',
          CODEMIN: '85',
          CU: '124',
        }),
        entry({
          PRIZNAK: 35,
          NOTE: 'Санкции Японии',
          DOC_N: 'БН_392',
          DOC_D: '2022-03-29',
          CODEMIN: '8517',
          CU: '392',
        }),
      ],
    });
    const report = await service.buildReport(tnved);
    expect(report.countryRestrictions).toHaveLength(2);
    const [first, second] = report.countryRestrictions;
    // narrow ('8517') должен идти перед broad ('85')
    expect(first.countryName).toBe('ЯПОНИЯ');
    expect(first.matchPrecision).toBe('narrow');
    expect(second.countryName).toBe('КАНАДА');
    expect(second.matchPrecision).toBe('broad');
    expect(first.title).toContain('ЯПОНИЯ');
  });

  it('переопределяет форму для лицензии импорта (PRIZNAK=7)', async () => {
    const service = makeService();
    const tnved = makeTnvedCode('8517130000', {
      '7': [
        entry({
          PRIZNAK: 7,
          NOTE: 'Ввоз / вывоз опасных отходов осуществляются при наличии лицензии. Постановлением Правительства РФ от 18.11.2024 N 1577.',
          DOC_N: '30',
          DOC_D: '2015-04-21',
          CODEMIN: '85',
        }),
      ],
    });
    const report = await service.buildReport(tnved);
    expect(report.licenses).toHaveLength(1);
    expect(report.licenses[0].form).toBe('license');
    expect(report.licenses[0].category).toBe('license_import');
  });

  it('игнорирует PRIZNAK, не относящиеся к разрешительным мерам (1, 3, 19, 30)', async () => {
    const service = makeService();
    const tnved = makeTnvedCode('8517130000', {
      '1': [entry({ PRIZNAK: 1, NOTE: 'Ввозная пошлина' })],
      '3': [entry({ PRIZNAK: 3, NOTE: 'НДС 20%' })],
      '19': [entry({ PRIZNAK: 19, NOTE: 'Антидемпинг' })],
      '30': [entry({ PRIZNAK: 30, NOTE: 'Преференция' })],
    });
    const report = await service.buildReport(tnved);
    expect(report.totalCount).toBe(0);
  });
});
