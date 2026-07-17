import { HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CalculatorService } from '../calculator/calculator.service';
import type { CurrencyService } from '../currency/currency.service';
import type { TnVedRateInfo, TnVedService, TnVedSearchResponse } from '../tn-ved/tn-ved.service';
import type { EstimateDto } from './dto/estimate.dto';
import { PublicCalculatorService } from './public-calculator.service';

/** Redis-мок под pipeline().incr().expire().exec() из fixedWindowHit (см. auth-throttle.guard.spec). */
function makeRedis(...counts: Array<number | 'down'>) {
  let call = 0;
  const pipeline = jest.fn(() => {
    const p = {
      incr: () => p,
      expire: () => p,
      exec: () => {
        const count = counts[call++] ?? 1;
        return count === 'down'
          ? Promise.reject(new Error('down'))
          : Promise.resolve([
              [null, count],
              [null, 1],
            ]);
      },
    };
    return p;
  });
  return { pipeline };
}

function rates(over: Partial<TnVedRateInfo> = {}): TnVedRateInfo {
  return {
    dutyRate: 10,
    dutyRateUnit: null,
    dutySign: null,
    dutyMin: null,
    dutyMinUnit: null,
    vatRate: 20,
    exciseRate: 0,
    exciseRateUnit: null,
    exciseSign: null,
    exciseMin: null,
    exciseMinUnit: null,
    ...over,
  };
}

/**
 * Ответ текстового поиска: ставками обогащён только топ (как при maxEnrich=1),
 * остальные коды доступны только в сырой выдаче rawTks.search.
 */
function textSearch(items: Array<{ code: string; rates?: Partial<TnVedRateInfo> }>): TnVedSearchResponse {
  return {
    mode: 'text_search',
    query: 'кроссовки',
    results: items.slice(0, 1).map((i, idx) => ({
      code: i.code,
      description: `Товар ${idx + 1}`,
      count: 100 - idx,
      rates: rates(i.rates),
    })),
    totalFound: items.length,
    rawTks: {
      codes: {},
      search: {
        hm: items.length,
        data: items.map((i, idx) => ({
          CODE: i.code,
          KR_NAIM: `Товар ${idx + 1}`,
          CNT: 100 - idx,
        })),
      },
    } as TnVedSearchResponse['rawTks'],
  };
}

function dto(over: Partial<EstimateDto> = {}): EstimateDto {
  return { query: 'кроссовки', price: 1000, currency: 'USD', ...over };
}

describe('PublicCalculatorService', () => {
  const OLD_LIMIT = process.env.PUBLIC_CALC_HOURLY_LIMIT;
  afterEach(() => {
    if (OLD_LIMIT === undefined) delete process.env.PUBLIC_CALC_HOURLY_LIMIT;
    else process.env.PUBLIC_CALC_HOURLY_LIMIT = OLD_LIMIT;
  });

  function makeService(search: TnVedSearchResponse, redis = makeRedis(1)) {
    const tnVed = { searchTks: jest.fn().mockResolvedValue(search) };
    const currency = {
      // 1 EUR = 1.08 USD; рубли: 1 USD = 90 ₽
      buildCurrencyToDocRates: jest.fn().mockResolvedValue({ USD: 1, EUR: 1.08 }),
      getRate: jest.fn().mockResolvedValue(90),
      toRubSync: (amount: number, rate: number) => Math.round(amount * rate * 100) / 100,
    };
    const service = new PublicCalculatorService(
      tnVed as unknown as TnVedService,
      new CalculatorService(),
      currency as unknown as CurrencyService,
      redis as never,
    );
    return { service, tnVed, currency };
  }

  it('адвалорная ставка: суммы в ₽ по курсу ЦБ, топ выдачи + альтернативы', async () => {
    const { service, tnVed } = makeService(
      textSearch([{ code: '6403990000' }, { code: '6404110000' }, { code: '6402990000' }]),
    );

    const result = await service.estimate(dto(), '1.2.3.4');

    expect(tnVed.searchTks).toHaveBeenCalledWith('кроссовки', 1);
    expect(result.code).toBe('6403990000');
    // 1000 USD: пошлина 10% = 100, НДС 20% от 1100 = 220 → в ₽ по 90
    expect(result.amounts.goodsRub).toBe(90_000);
    expect(result.amounts.dutyRub).toBe(9_000);
    expect(result.amounts.vatRub).toBe(19_800);
    expect(result.amounts.paymentsRub).toBe(28_800);
    expect(result.amounts.totalRub).toBe(118_800);
    expect(result.exchangeRate).toBe(90);
    expect(result.isEstimate).toBe(false);
    expect(result.alternatives.map((a) => a.code)).toEqual(['6404110000', '6402990000']);
  });

  it('специфическая ставка за пару: количество делит партию, ставка конвертируется по курсу EUR', async () => {
    const { service } = makeService(
      textSearch([{ code: '6403990000', rates: { dutyRate: 0.5, dutyRateUnit: 'EUR/пар' } }]),
    );

    const result = await service.estimate(dto({ quantity: 4 }), '1.2.3.4');

    // 0.5 EUR × 4 пары × 1.08 = 2.16 USD → 194.4 ₽; товар 1000 USD не меняется от quantity
    expect(result.amounts.goodsRub).toBe(90_000);
    expect(result.amounts.dutyRub).toBeCloseTo(194.4, 2);
    expect(result.isEstimate).toBe(false);
  });

  it('специфическая ставка EUR/кг без веса → оценка с предупреждением, не молчаливый ноль', async () => {
    const { service } = makeService(
      textSearch([{ code: '0202100000', rates: { dutyRate: 2, dutyRateUnit: 'EUR/кг' } }]),
    );

    const result = await service.estimate(dto(), '1.2.3.4');

    expect(result.isEstimate).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('code_lookup: берётся codeDetail, альтернативы из примеров related', async () => {
    const { service } = makeService({
      mode: 'code_lookup',
      query: '6403 99',
      codeDetail: {
        code: '6403990000',
        description: 'Обувь прочая',
        rates: rates(),
        extendedRates: {
          tempDuty: null,
          tempDutyUnit: null,
          antidumpingDuty: null,
          antidumpingDutyUnit: null,
          compensatoryDuty: null,
          compensatoryDutyUnit: null,
          additionalDuty: null,
          additionalUnits: [],
        },
        countryDuties: [],
        conditionalExcises: [],
        declarations: [],
        regulatoryReport: { items: [], summary: [] } as never,
      },
      results: textSearch([{ code: '6404110000' }]).results,
      totalFound: 1,
    });

    const result = await service.estimate(dto({ code: '6403990000' }), '1.2.3.4');

    expect(result.code).toBe('6403990000');
    expect(result.codeDescription).toBe('Обувь прочая');
    expect(result.alternatives).toEqual([{ code: '6404110000', description: 'Товар 1' }]);
  });

  it('специфический акциз без AI-интерпретатора не считается как процент — зануляется с нотой', async () => {
    const { service } = makeService(
      textSearch([{ code: '2203000100', rates: { exciseRate: 30, exciseRateUnit: 'RUB/л' } }]),
    );

    const result = await service.estimate(dto(), '1.2.3.4');

    expect(result.amounts.exciseRub).toBe(0);
    expect(result.exciseRate).toBe(0);
    expect(result.isEstimate).toBe(true);
    expect(result.notes.some((n) => n.message.includes('подакцизный'))).toBe(true);
  });

  it('пустая выдача → 404 CALC_NOTHING_FOUND', async () => {
    const { service } = makeService(textSearch([]));
    await expect(service.estimate(dto(), '1.2.3.4')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('сбой TKS → 503 TKS_UNAVAILABLE, а не 500', async () => {
    const { service, tnVed } = makeService(textSearch([{ code: '6403990000' }]));
    tnVed.searchTks.mockRejectedValue(new Error('TKS API error: 404 NOT FOUND'));
    await expect(service.estimate(dto(), '1.2.3.4')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('превышение лимита по IP → 429, поиск не вызывается', async () => {
    process.env.PUBLIC_CALC_HOURLY_LIMIT = '20';
    const { service, tnVed } = makeService(textSearch([{ code: '6403990000' }]), makeRedis(21));
    await expect(service.estimate(dto(), '1.2.3.4')).rejects.toBeInstanceOf(HttpException);
    expect(tnVed.searchTks).not.toHaveBeenCalled();
  });

  it('недоступный Redis → fail-open (расчёт выполняется)', async () => {
    const { service } = makeService(textSearch([{ code: '6403990000' }]), makeRedis('down'));
    const result = await service.estimate(dto(), '1.2.3.4');
    expect(result.code).toBe('6403990000');
  });
});
