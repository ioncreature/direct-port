import {
  InvalidFreightError,
  computeWeightDenominator,
  normalizeFreightInput,
  resolveFreightTotalInDocCurrency,
} from './freight';

describe('normalizeFreightInput', () => {
  it('cost > 0 + currency → returns both values', () => {
    expect(normalizeFreightInput({ freightCost: 100, freightCurrency: 'USD' })).toEqual({
      freightCost: 100,
      freightCurrency: 'USD',
    });
  });

  it('cost = 0 + any currency → both null (reset semantics)', () => {
    // Эта ветка критична: recalculate подставляет старую валюту из doc, и без сброса
    // через 0 пользователь не смог бы убрать ранее заданный фрахт.
    expect(normalizeFreightInput({ freightCost: 0, freightCurrency: 'USD' })).toEqual({
      freightCost: null,
      freightCurrency: null,
    });
  });

  it('cost = undefined → both null', () => {
    expect(normalizeFreightInput({})).toEqual({ freightCost: null, freightCurrency: null });
  });

  it('cost = null → both null', () => {
    expect(normalizeFreightInput({ freightCost: null, freightCurrency: null })).toEqual({
      freightCost: null,
      freightCurrency: null,
    });
  });

  it('negative cost → both null (treated as no freight, not an error)', () => {
    expect(normalizeFreightInput({ freightCost: -10, freightCurrency: 'USD' })).toEqual({
      freightCost: null,
      freightCurrency: null,
    });
  });

  it('cost > 0 without currency → throws InvalidFreightError', () => {
    expect(() => normalizeFreightInput({ freightCost: 100 })).toThrow(InvalidFreightError);
  });

  it('cost > 0 with null currency → throws InvalidFreightError', () => {
    expect(() => normalizeFreightInput({ freightCost: 100, freightCurrency: null })).toThrow(
      InvalidFreightError,
    );
  });
});

describe('resolveFreightTotalInDocCurrency', () => {
  it('happy path: cost × rate', () => {
    expect(
      resolveFreightTotalInDocCurrency(
        { freightCost: 2200, freightCurrency: 'USD' },
        { USD: 7.5, CNY: 1 },
      ),
    ).toBe(2200 * 7.5);
  });

  it('null freightCost → null', () => {
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: null, freightCurrency: 'USD' }, { USD: 1 }),
    ).toBeNull();
  });

  it('null freightCurrency → null', () => {
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: 100, freightCurrency: null }, { USD: 1 }),
    ).toBeNull();
  });

  it('cost = 0 → null', () => {
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: 0, freightCurrency: 'USD' }, { USD: 1 }),
    ).toBeNull();
  });

  it('missing currency in rates map → null', () => {
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: 100, freightCurrency: 'USD' }, { CNY: 1 }),
    ).toBeNull();
  });

  it('non-finite rate → null', () => {
    expect(
      resolveFreightTotalInDocCurrency(
        { freightCost: 100, freightCurrency: 'USD' },
        { USD: Infinity },
      ),
    ).toBeNull();
  });

  it('zero or negative rate → null', () => {
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: 100, freightCurrency: 'USD' }, { USD: 0 }),
    ).toBeNull();
    expect(
      resolveFreightTotalInDocCurrency({ freightCost: 100, freightCurrency: 'USD' }, { USD: -1 }),
    ).toBeNull();
  });
});

describe('computeWeightDenominator', () => {
  it('sums weight × quantity', () => {
    expect(
      computeWeightDenominator([
        { weight: 2, quantity: 10 },
        { weight: 0.5, quantity: 4 },
      ]),
    ).toBe(22);
  });

  it('treats null/undefined as 0', () => {
    expect(
      computeWeightDenominator([
        { weight: null, quantity: 10 },
        { weight: 5, quantity: undefined },
        { weight: 1, quantity: 3 },
      ]),
    ).toBe(3);
  });

  it('coerces string numerics (parsedData may hold strings)', () => {
    // weight/quantity в Document.parsedData приходят из JSONB и иногда как строки.
    // Helper использует Number() → "3"*"4" должен дать 12.
    const rows = [{ weight: '3' as unknown as number, quantity: '4' as unknown as number }];
    expect(computeWeightDenominator(rows)).toBe(12);
  });

  it('empty list → 0', () => {
    expect(computeWeightDenominator([])).toBe(0);
  });

  it('строки с Infinity/NaN-весом исключаются из знаменателя', () => {
    // Такие строки не получают долю фрахта в Calculator — если бы их вес сидел
    // в знаменателе, часть фрахта «испарилась» бы из распределения.
    expect(
      computeWeightDenominator([
        { weight: Infinity, quantity: 1 },
        { weight: NaN as unknown as number, quantity: 2 },
        { weight: 2, quantity: 10 },
      ]),
    ).toBe(20);
  });
});
