import { CurrencyService } from './currency.service';

const CBR_RESPONSE = {
  Date: '2025-04-10T11:30:00+03:00',
  Valute: {
    USD: { CharCode: 'USD', Nominal: 1, Value: 92.5 },
    EUR: { CharCode: 'EUR', Nominal: 1, Value: 100.2 },
    CNY: { CharCode: 'CNY', Nominal: 1, Value: 12.7 },
    KZT: { CharCode: 'KZT', Nominal: 100, Value: 19.5 },
  },
};

function mockFetchSuccess() {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => CBR_RESPONSE,
  } as Response);
}

function mockFetchFailure(status = 500) {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
  } as Response);
}

describe('CurrencyService', () => {
  let service: CurrencyService;

  beforeEach(() => {
    service = new CurrencyService();
    jest.restoreAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getRate()', () => {
    it('возвращает 1 для RUB без запроса к API', async () => {
      mockFetchSuccess();
      const rate = await service.getRate('RUB');
      expect(rate).toBe(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('возвращает курс USD из ЦБ', async () => {
      mockFetchSuccess();
      const rate = await service.getRate('USD');
      expect(rate).toBe(92.5);
    });

    it('возвращает курс EUR из ЦБ', async () => {
      mockFetchSuccess();
      const rate = await service.getRate('EUR');
      expect(rate).toBe(100.2);
    });

    it('учитывает Nominal (KZT: Nominal=100, Value=19.5 → rate=0.195)', async () => {
      mockFetchSuccess();
      const rate = await service.getRate('KZT');
      expect(rate).toBeCloseTo(0.195);
    });

    it('выбрасывает ошибку для неизвестной валюты', async () => {
      mockFetchSuccess();
      await expect(service.getRate('XYZ')).rejects.toThrow('Курс валюты XYZ не найден');
    });
  });

  describe('toRub()', () => {
    it('конвертирует USD → RUB', async () => {
      mockFetchSuccess();
      const rub = await service.toRub(100, 'USD');
      expect(rub).toBe(9250);
    });

    it('конвертирует RUB → RUB (без изменений)', async () => {
      mockFetchSuccess();
      const rub = await service.toRub(100, 'RUB');
      expect(rub).toBe(100);
    });

    it('округляет до 2 знаков', async () => {
      mockFetchSuccess();
      const rub = await service.toRub(1.111, 'USD');
      expect(rub).toBe(102.77);
    });
  });

  describe('toRubSync()', () => {
    it('конвертирует по готовому курсу', () => {
      expect(service.toRubSync(100, 92.5)).toBe(9250);
    });

    it('округляет до 2 знаков', () => {
      expect(service.toRubSync(1.111, 92.5)).toBe(102.77);
    });

    it('нулевая сумма', () => {
      expect(service.toRubSync(0, 92.5)).toBe(0);
    });
  });

  describe('Кэширование', () => {
    it('не делает повторный запрос в пределах TTL', async () => {
      mockFetchSuccess();

      await service.getRate('USD');
      await service.getRate('EUR');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Stale fallback', () => {
    it('использует stale кэш при ошибке API', async () => {
      mockFetchSuccess();
      await service.getRate('USD');

      // Продвигаем время за пределы TTL (1 час + 1мс)
      jest.advanceTimersByTime(3_600_001);
      jest.restoreAllMocks();
      mockFetchFailure(500);

      const rate = await service.getRate('USD');
      expect(rate).toBe(92.5);
    });

    it('использует stale кэш при сетевой ошибке/таймауте (fetch бросает)', async () => {
      mockFetchSuccess();
      await service.getRate('USD');

      jest.advanceTimersByTime(3_600_001);
      jest.restoreAllMocks();
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ETIMEDOUT'));

      const rate = await service.getRate('USD');
      expect(rate).toBe(92.5);
    });

    it('использует stale кэш при повреждённом JSON', async () => {
      mockFetchSuccess();
      await service.getRate('USD');

      jest.advanceTimersByTime(3_600_001);
      jest.restoreAllMocks();
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('unexpected token');
        },
      } as unknown as Response);

      const rate = await service.getRate('USD');
      expect(rate).toBe(92.5);
    });

    it('пустой Valute не затирает валидный кэш — отдаём stale', async () => {
      mockFetchSuccess();
      await service.getRate('USD');

      jest.advanceTimersByTime(3_600_001);
      jest.restoreAllMocks();
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ Date: '2025-04-11', Valute: {} }),
      } as unknown as Response);

      const rate = await service.getRate('USD');
      expect(rate).toBe(92.5);
    });

    it('выбрасывает ошибку если нет кэша и API недоступен', async () => {
      mockFetchFailure(500);
      await expect(service.getRate('USD')).rejects.toThrow('Не удалось получить курсы валют');
    });

    it('выбрасывает ошибку если нет кэша и fetch бросает', async () => {
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.getRate('USD')).rejects.toThrow('Не удалось получить курсы валют');
    });
  });

  describe('Валидация курсов', () => {
    it('нулевые и отрицательные значения не попадают в кэш', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          Date: '2025-04-10',
          Valute: {
            USD: { CharCode: 'USD', Nominal: 1, Value: 0 },
            EUR: { CharCode: 'EUR', Nominal: 0, Value: 100 },
            CNY: { CharCode: 'CNY', Nominal: 1, Value: 12.7 },
          },
        }),
      } as unknown as Response);

      await expect(service.getRate('USD')).rejects.toThrow('Курс валюты USD не найден');
      await expect(service.getRate('EUR')).rejects.toThrow('Курс валюты EUR не найден');
      expect(await service.getRate('CNY')).toBe(12.7);
    });
  });

  describe('buildCurrencyToDocRates()', () => {
    it('строит кросс-курсы валют ставок к валюте документа (USD-документ)', async () => {
      mockFetchSuccess();
      const rates = await service.buildCurrencyToDocRates('USD', ['EUR', 'CNY']);
      expect(rates.USD).toBe(1);
      expect(rates.EUR).toBeCloseTo(100.2 / 92.5, 4); // EUR-ставка в долларах документа
      expect(rates.CNY).toBeCloseTo(12.7 / 92.5, 4);
    });

    it('для RUB-документа курс валюты ставки = рублёвый курс ЦБ', async () => {
      mockFetchSuccess();
      const rates = await service.buildCurrencyToDocRates('RUB', ['USD', 'EUR']);
      expect(rates.RUB).toBe(1);
      expect(rates.USD).toBe(92.5);
      expect(rates.EUR).toBe(100.2);
    });

    it('валюта документа всегда присутствует с курсом 1', async () => {
      mockFetchSuccess();
      const rates = await service.buildCurrencyToDocRates('EUR', ['EUR']);
      expect(rates.EUR).toBe(1);
    });

    it('курс валюты документа недоступен → единичная карта (ставки станут estimated)', async () => {
      mockFetchSuccess();
      const rates = await service.buildCurrencyToDocRates('XYZ', ['USD']);
      expect(rates).toEqual({ XYZ: 1 });
    });

    it('валюта ставки без курса в ЦБ исключается, остальные остаются', async () => {
      mockFetchSuccess();
      const rates = await service.buildCurrencyToDocRates('USD', ['EUR', 'XYZ']);
      expect(rates.USD).toBe(1);
      expect(rates.EUR).toBeCloseTo(100.2 / 92.5, 4);
      expect(rates.XYZ).toBeUndefined();
    });
  });
});
