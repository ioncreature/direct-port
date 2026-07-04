import { MARKING_WAVES, matchMarkingWaves, type MarkingWave } from './marking-waves';

function makeWave(overrides: Partial<MarkingWave> = {}): MarkingWave {
  return {
    group: 'Тестовая группа',
    tnVedPrefixes: ['6403'],
    mandatoryFrom: '2020-07-01',
    basis: 'ПП РФ № 000',
    verifiedAt: '2026-07-05',
    ...overrides,
  };
}

describe('matchMarkingWaves', () => {
  it('находит волну по префиксу кода', () => {
    const waves = [makeWave({ tnVedPrefixes: ['6403'] })];
    expect(matchMarkingWaves('6403911100', waves)).toHaveLength(1);
  });

  it('не матчит код другого префикса', () => {
    const waves = [makeWave({ tnVedPrefixes: ['6403'] })];
    expect(matchMarkingWaves('8482109008', waves)).toHaveLength(0);
  });

  it('игнорирует пробелы в коде', () => {
    const waves = [makeWave({ tnVedPrefixes: ['640391'] })];
    expect(matchMarkingWaves('6403 91 1100', waves)).toHaveLength(1);
  });

  it('пустой код — пустой результат', () => {
    expect(matchMarkingWaves('', [makeWave()])).toHaveLength(0);
  });

  it('код может совпасть с несколькими группами', () => {
    const waves = [
      makeWave({ group: 'A', tnVedPrefixes: ['2202'] }),
      makeWave({ group: 'B', tnVedPrefixes: ['220299'] }),
    ];
    expect(matchMarkingWaves('2202991100', waves).map((w) => w.group)).toEqual(['A', 'B']);
  });

  describe('реальные данные MARKING_WAVES', () => {
    it('обувь 6403911100 — активная волна с 01.07.2020', () => {
      const waves = matchMarkingWaves('6403911100');
      expect(waves.some((w) => w.group === 'Обувь' && w.mandatoryFrom === '2020-07-01')).toBe(true);
    });

    it('ноутбуки 8471300000 — радиоэлектроника с 01.05.2026', () => {
      const waves = matchMarkingWaves('8471300000');
      expect(waves.some((w) => w.mandatoryFrom === '2026-05-01')).toBe(true);
    });

    it('подшипники 8482109008 — волн нет', () => {
      expect(matchMarkingWaves('8482109008')).toHaveLength(0);
    });

    it('каждая запись имеет basis с реквизитом и verifiedAt', () => {
      for (const wave of MARKING_WAVES) {
        expect(wave.basis).toMatch(/(ПП РФ|956-р|1556)/);
        expect(wave.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(wave.mandatoryFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(wave.tnVedPrefixes.length).toBeGreaterThan(0);
        for (const prefix of wave.tnVedPrefixes) {
          expect(prefix).toMatch(/^\d{2,10}$/);
        }
      }
    });
  });
});
