import { normalizeImpediUnit } from './normalize-impedi';

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
    ['166', 'EUR/кг'],
    ['796', 'EUR/шт'],
    ['055', 'EUR/м²'],
    ['113', 'EUR/м³'],
    ['112', 'EUR/л'],
    ['163', 'EUR/г'],
    ['168', 'EUR/т'],
    ['006', 'EUR/м'],
  ])('конвертирует код ОКЕИ %s → %s', (input, expected) => {
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
