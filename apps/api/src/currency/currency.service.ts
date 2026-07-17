import { Injectable, Logger } from '@nestjs/common';
import { errMsg } from '../common/errors';

interface CbrRate {
  CharCode: string;
  Nominal: number;
  Value: number;
}

interface CbrResponse {
  Date: string;
  Valute: Record<string, CbrRate>;
}

const CACHE_TTL = 3600_000; // 1 hour

@Injectable()
export class CurrencyService {
  private logger = new Logger(CurrencyService.name);
  private cache: { rates: Map<string, number>; date: string; fetchedAt: number } | null = null;
  private inFlight: Promise<Map<string, number>> | null = null;

  /** Returns exchange rate: 1 unit of `from` currency = X RUB */
  async getRate(from: string): Promise<number> {
    if (from === 'RUB') return 1;
    const rates = await this.getRates();
    const rate = rates.get(from);
    if (!rate) {
      throw new Error(`Курс валюты ${from} не найден в справочнике ЦБ РФ`);
    }
    return rate;
  }

  /** Converts amount from source currency to RUB, rounded to 2 decimal places */
  async toRub(amount: number, from: string): Promise<number> {
    const rate = await this.getRate(from);
    return this.toRubSync(amount, rate);
  }

  /** Converts amount using a pre-fetched rate, rounded to 2 decimal places */
  toRubSync(amount: number, rate: number): number {
    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Курсы вида «1 единица валюты X → доля валюты документа», для каждой валюты
   * из `currencies` (плюс сама валюта документа). Pipeline calculator использует
   * их, чтобы привести specific-ставки в EUR/USD/CNY к валюте позиции.
   *
   * Если курс валюты документа недоступен в ЦБ — возвращаем единичную карту,
   * остальные ставки calculator пометит estimated с blocker-note.
   */
  async buildCurrencyToDocRates(
    docCurrency: string,
    currencies: readonly string[],
  ): Promise<Record<string, number>> {
    const targets = Array.from(new Set([docCurrency, ...currencies]));
    const fetched = await Promise.all(
      targets.map(async (c) => {
        if (c === 'RUB') return [c, 1] as const;
        try {
          return [c, await this.getRate(c)] as const;
        } catch {
          return [c, null] as const;
        }
      }),
    );
    const rubPerUnit = Object.fromEntries(fetched.filter((e) => e[1] != null)) as Record<
      string,
      number
    >;

    const docInRub = rubPerUnit[docCurrency];
    if (docInRub == null) {
      this.logger.warn(
        `Rate for document currency ${docCurrency} unavailable — only ad valorem duties will be exact`,
      );
      return { [docCurrency]: 1 };
    }

    const rates: Record<string, number> = { [docCurrency]: 1 };
    for (const [c, rub] of Object.entries(rubPerUnit)) {
      if (c === docCurrency) continue;
      const r = rub / docInRub;
      if (Number.isFinite(r) && r > 0) rates[c] = r;
    }
    return rates;
  }

  private async getRates(): Promise<Map<string, number>> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
      return this.cache.rates;
    }

    // Stale-fallback должен покрывать ЛЮБОЙ сбой источника: сетевые ошибки и таймауты
    // fetch бросают исключение до проверки response.ok, повреждённый JSON — на парсинге.
    // Курсы ЦБ меняются раз в день, так что протухший на часы кэш лучше, чем уронить
    // документ после уже оплаченных AI-этапов.
    // Single-flight: buildCurrencyToDocRates конкурентно зовёт getRate для ~10 валют —
    // без дедупликации холодный кэш давал бы залп одинаковых HTTP-запросов к ЦБ.
    try {
      this.inFlight ??= this.fetchRates().finally(() => {
        this.inFlight = null;
      });
      return await this.inFlight;
    } catch (err) {
      if (this.cache) {
        this.logger.warn(
          `CBR fetch failed (${errMsg(err)}), using stale cache from ${this.cache.date}`,
        );
        return this.cache.rates;
      }
      throw new Error(`Не удалось получить курсы валют ЦБ РФ: ${errMsg(err)}`);
    }
  }

  private async fetchRates(): Promise<Map<string, number>> {
    const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as CbrResponse;
    const rates = new Map<string, number>();

    for (const info of Object.values(data.Valute ?? {})) {
      // Источник — неофициальное зеркало ЦБ: нулевой/отрицательный курс из битого
      // ответа дал бы нулевые пошлины по всему документу.
      const rate = info.Value / info.Nominal;
      if (Number.isFinite(rate) && rate > 0) rates.set(info.CharCode, rate);
    }
    if (rates.size === 0) {
      // Пустой ответ не должен затирать валидный кэш — кидаем до записи в this.cache.
      throw new Error('пустой или повреждённый ответ (нет валидных курсов)');
    }

    this.cache = { rates, date: data.Date, fetchedAt: Date.now() };
    this.logger.log(`Loaded ${rates.size} exchange rates from CBR (${data.Date})`);
    return rates;
  }
}
