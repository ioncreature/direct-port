import { estimateCustomsFeeRub } from './customs-fee';

describe('estimateCustomsFeeRub', () => {
  it.each([
    [100_000, 1_231],
    [200_000, 1_231], // граница включительно
    [200_000.01, 2_462],
    [450_000, 2_462],
    [1_000_000, 4_924],
    [1_200_000.01, 13_541],
    [3_000_000, 18_465],
    [5_000_000, 21_344],
    [7_000_000, 49_240],
    [10_000_000, 49_240],
    [10_000_000.01, 73_860],
    [50_000_000, 73_860],
  ])('стоимость %p ₽ → сбор %p ₽ (лестница ПП № 1637 в ред. № 1638)', (value, fee) => {
    expect(estimateCustomsFeeRub(value)).toBe(fee);
  });

  it('null/нечисловое → null (сбор не показываем вместо выдуманного)', () => {
    expect(estimateCustomsFeeRub(null)).toBeNull();
    expect(estimateCustomsFeeRub(NaN)).toBeNull();
    expect(estimateCustomsFeeRub(-1)).toBeNull();
  });
});
