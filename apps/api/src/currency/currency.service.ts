import { Injectable, Logger } from '@nestjs/common';

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

  private async getRates(): Promise<Map<string, number>> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
      return this.cache.rates;
    }

    const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (this.cache) {
        this.logger.warn(`CBR API returned ${response.status}, using stale cache from ${this.cache.date}`);
        return this.cache.rates;
      }
      throw new Error(`Не удалось получить курсы валют ЦБ РФ: ${response.status}`);
    }

    const data = (await response.json()) as CbrResponse;
    const rates = new Map<string, number>();

    for (const info of Object.values(data.Valute)) {
      rates.set(info.CharCode, info.Value / info.Nominal);
    }

    this.cache = { rates, date: data.Date, fetchedAt: Date.now() };
    this.logger.log(`Loaded ${rates.size} exchange rates from CBR (${data.Date})`);
    return rates;
  }
}
