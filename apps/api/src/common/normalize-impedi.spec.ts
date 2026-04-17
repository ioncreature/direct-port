import { isSpecificDutyUnit, normalizeImpediUnit } from './normalize-impedi';

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
    ['162', 'EUR/кар'],
    ['214', 'EUR/КВТ'],
  ])('конвертирует ОКЕИ %s → %s (EUR)', (input, expected) => {
    expect(normalizeImpediUnit(input)).toBe(expected);
  });

  it.each([
    ['166D', 'USD/кг'],
    ['168D', 'USD/т'],
    ['166Р', 'RUB/кг'],
    ['796Р', 'RUB/шт'],
    ['112K', 'KZT/л'],
    ['166B', 'BYR/кг'],
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
