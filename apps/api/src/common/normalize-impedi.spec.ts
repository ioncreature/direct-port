import {
  extractCurrency,
  isFlatCurrencyUnit,
  isSpecificDutyUnit,
  normalizeImpediUnit,
} from './normalize-impedi';

describe('normalizeImpediUnit', () => {
  it('возвращает null для пустых значений', () => {
    expect(normalizeImpediUnit(null)).toBeNull();
    expect(normalizeImpediUnit(undefined)).toBeNull();
    expect(normalizeImpediUnit('')).toBeNull();
  });

  it('не изменяет значения с / (уже в формате EUR/кг)', () => {
    expect(normalizeImpediUnit('EUR/кг')).toBe('EUR/кг');
    expect(normalizeImpediUnit('EUR/л')).toBe('EUR/л');
    expect(normalizeImpediUnit('USD/шт')).toBe('USD/шт');
  });

  it.each([
    ['1', '%'],
    ['2', '%'],
    ['%', '%'],
  ])('адвалорная ставка %s → %s', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });

  it.each([
    ['166', 'EUR/кг'],
    ['796', 'EUR/шт'],
    ['055', 'EUR/м²'],
    ['113', 'EUR/м³'],
    ['112', 'EUR/л'],
    ['163', 'EUR/г'],
    ['168', 'EUR/т'],
    ['006', 'EUR/м'],
    ['715', 'EUR/пар'],
    ['798', 'EUR/1000шт'],
    ['111', 'EUR/см³'],
    ['114', 'EUR/1000м³'],
    ['130', 'EUR/1000л'],
    ['133', 'EUR/кг'],
    ['162', 'EUR/кар'],
    ['185', 'EUR/т грп'],
    ['214', 'EUR/КВТ'],
    ['251', 'EUR/Л.С.'],
    ['831', 'EUR/л 100% спирта'],
    ['500', 'EUR'],
  ])('конвертирует ОКЕИ %s → %s (EUR)', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });

  it.each([
    ['166D', 'USD/кг'],
    ['168D', 'USD/т'],
    ['166Р', 'RUB/кг'],
    ['796Р', 'RUB/шт'],
    ['112K', 'KZT/л'],
    ['166B', 'BYN/кг'],
    ['168A', 'AMD/т'],
    ['112C', 'KGS/л'],
  ])('ОКЕИ с валютным суффиксом: %s → %s', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });

  it('с пробелами: " 166 " → EUR/кг', () => {
    expect(normalizeImpediUnit(' 166 ')).toBe('EUR/кг');
  });

  it('возвращает raw для неизвестного кода', () => {
    expect(normalizeImpediUnit('999')).toBe('999');
    expect(normalizeImpediUnit('unknown')).toBe('unknown');
  });

  it.each([
    ['55', 'EUR/м²'],
    ['6', 'EUR/м'],
    ['55Р', 'RUB/м²'],
  ])('дополняет ведущие нули: %s → %s', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });

  it.each([
    ['643', 'RUB'],
  ])('код чистой валюты ОКВ %s → %s', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });
});

describe('isFlatCurrencyUnit', () => {
  it.each([
    ['EUR', true],
    ['RUB', true],
    ['USD', true],
    ['BYN', true],
    ['EUR/кг', false],
    ['%', false],
    [null, false],
    [undefined, false],
    ['', false],
    ['м2', false],
    ['999', false],
  ])('isFlatCurrencyUnit(%j) → %j', (input, expected) => {
    expect(isFlatCurrencyUnit(input as string | null | undefined)).toBe(expected);
  });
});

describe('extractCurrency', () => {
  it.each([
    ['EUR/кг', 'EUR'],
    ['USD/т', 'USD'],
    ['RUB/шт', 'RUB'],
    ['EUR', 'EUR'],
    ['RUB', 'RUB'],
    ['%', null],
    [null, null],
    [undefined, null],
    ['', null],
  ])('extractCurrency(%j) → %j', (input, expected) => {
    expect(extractCurrency(input)).toBe(expected);
  });
});

describe('isSpecificDutyUnit', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['%', false],
    ['EUR/кг', true],
    ['USD/т', true],
    ['EUR/пар', true],
    ['RUB/шт', true],
  ])('isSpecificDutyUnit(%j) → %j', (input, expected) => {
    expect(isSpecificDutyUnit(input)).toBe(expected);
  });
});
