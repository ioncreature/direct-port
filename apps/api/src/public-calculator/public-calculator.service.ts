import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { CalculatorService } from '../calculator/calculator.service';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import { readNonNegIntEnv } from '../common/env';
import { ErrorCode } from '../common/error-codes';
import { errMsg } from '../common/errors';
import { isSpecificDutyUnit, KNOWN_CURRENCIES } from '../common/normalize-impedi';
import { assertFixedWindowLimit } from '../common/rate-limit';
import { CurrencyService } from '../currency/currency.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TnVedService, type TnVedRateInfo, type TnVedSearchResponse } from '../tn-ved/tn-ved.service';
import type { EstimateDto } from './dto/estimate.dto';

/** Сколько альтернативных кодов показываем рядом с выбранным. */
const MAX_ALTERNATIVES = 3;

const RATE_KEY_PREFIX = 'public-calc-rate:';
const RATE_WINDOW_SECONDS = 3600;
const hourlyLimit = () => readNonNegIntEnv('PUBLIC_CALC_HOURLY_LIMIT', 20);

export interface PublicEstimateNote {
  message: string;
  messageLocalized?: string;
}

export interface PublicEstimateResult {
  query: string;
  /** Перевод запроса на русский (если отличался) — показываем «искали как …». */
  translatedQuery?: string;
  code: string;
  codeDescription: string;
  /** Человекочитаемая ставка пошлины: "10%", "10% ≥ 0.34 €/пара". */
  dutyRateDisplay: string;
  vatRate: number;
  exciseRate: number;
  currency: string;
  /** Курс ЦБ РФ: рублей за единицу валюты запроса. */
  exchangeRate: number;
  amounts: {
    goodsRub: number;
    dutyRub: number;
    exciseRub: number;
    vatRub: number;
    /** Таможенные платежи: пошлина + акциз + НДС. */
    paymentsRub: number;
    /** Товар + платежи. */
    totalRub: number;
  };
  /** true — оценка неполная (не хватило веса/количества для специфической ставки и т. п.). */
  isEstimate: boolean;
  notes: PublicEstimateNote[];
  alternatives: { code: string; description: string }[];
}

/**
 * Публичный мини-калькулятор лендинга: один товар без регистрации.
 * Конвертер холодного трафика (docs/PROMOTION_STRATEGIES.md, канал № 3): посетитель
 * получает код ТН ВЭД и оценку платежей в ₽, полный прайс — уже в боте.
 *
 * Переиспользует боевые механизмы: TnVedService.searchTks (перевод запроса + поиск TKS
 * со ставками, всё под PG-кэшем), CalculatorService (та же формула, что в pipeline,
 * детерминистический fallback без AI-интерпретатора) и CurrencyService (курсы ЦБ).
 * Claude на запрос дёргается максимум один раз (перевод не-русского запроса, haiku,
 * max_tokens=100) — стоимость злоупотребления ограничена rate-limit'ом по IP.
 */
@Injectable()
export class PublicCalculatorService {
  private logger = new Logger(PublicCalculatorService.name);

  constructor(
    private tnVed: TnVedService,
    private calculator: CalculatorService,
    private currency: CurrencyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async estimate(dto: EstimateDto, ip: string): Promise<PublicEstimateResult> {
    await this.assertRateLimit(ip);

    // Курсы ЦБ не зависят от поиска — греем параллельно (оба промиса не reject'ятся:
    // getRate обёрнут в catch, buildCurrencyToDocRates ловит сбои внутри).
    const currencyPromise = Promise.all([
      this.currency.buildCurrencyToDocRates(dto.currency, KNOWN_CURRENCIES),
      this.currency.getRate(dto.currency).catch((err) => {
        this.logger.warn(`CBR rate unavailable for ${dto.currency}: ${errMsg(err)}`);
        return null;
      }),
    ]);

    const searchQuery = dto.code ?? dto.query;
    // TksApiError (сбой/недоступность справочника) не должен утекать как 500 —
    // для посетителя лендинга это временная недоступность сервиса.
    // Ставками обогащаем только топ выдачи: альтернативам нужны лишь код и описание.
    const search = await this.tnVed.searchTks(searchQuery, 1).catch((err) => {
      this.logger.warn(`TKS search failed for public calc: ${errMsg(err)}`);
      throw new ServiceUnavailableException({
        code: ErrorCode.TKS_UNAVAILABLE,
        message: 'Справочник ТН ВЭД временно недоступен — попробуйте позже',
      });
    });
    const picked = this.pickCandidate(search);
    if (!picked) {
      throw new NotFoundException({
        code: ErrorCode.CALC_NOTHING_FOUND,
        message: 'Ничего не найдено по запросу — уточните описание товара или код ТН ВЭД',
      });
    }

    const quantity = dto.quantity ?? 1;
    const product = this.buildProduct(dto, quantity, picked);

    // Специфический акциз (RUB/л, EUR/тыс.шт) без AI-интерпретатора посчитался бы как
    // адвалорный процент — мусор хуже честного «не считаем». Зануляем с предупреждением.
    let exciseSkipped = false;
    if (isSpecificDutyUnit(picked.rates.exciseRateUnit) && product.exciseRate > 0) {
      product.exciseRate = 0;
      exciseSkipped = true;
    }

    const [currencyToDoc, exchangeRate] = await currencyPromise;
    if (exchangeRate == null) {
      throw new ServiceUnavailableException({
        code: ErrorCode.CBR_UNAVAILABLE,
        message: 'Курсы ЦБ РФ временно недоступны — попробуйте позже',
      });
    }

    const summary = this.calculator.calculate([product], {
      currencyToDoc,
      countryOfOrigin: null,
      language: dto.lang ?? 'ru',
    });
    const item = summary.items[0];

    const toRub = (v: number) => this.currency.toRubSync(v, exchangeRate);
    const paymentsRub = toRub(item.dutyAmount + item.exciseAmount + item.vatAmount);

    const notes: PublicEstimateNote[] = item.notes
      .filter((n) => n.severity === 'warning' || n.severity === 'blocker')
      .map((n) => ({ message: n.message, messageLocalized: n.messageLocalized }));
    if (exciseSkipped) {
      notes.push({
        message:
          'Товар подакцизный со специфической ставкой — акциз здесь не посчитан, полный расчёт делает сервис.',
      });
    }

    return {
      query: dto.query,
      translatedQuery: search.translatedQuery,
      code: item.tnVedCode,
      codeDescription: item.tnVedDescription,
      dutyRateDisplay: item.dutyRateDisplay,
      vatRate: item.vatRate,
      exciseRate: item.exciseRate,
      currency: dto.currency,
      exchangeRate,
      amounts: {
        goodsRub: toRub(item.totalPrice),
        dutyRub: toRub(item.dutyAmount),
        exciseRub: toRub(item.exciseAmount),
        vatRub: toRub(item.vatAmount),
        paymentsRub,
        totalRub: toRub(item.totalCost),
      },
      isEstimate: item.dutyAmountIsEstimate || item.calculationStatus !== 'exact' || exciseSkipped,
      notes,
      alternatives: picked.alternatives,
    };
  }

  /**
   * Выбор кода из ответа справочника: точный код (code_lookup) или топ текстовой выдачи.
   * Альтернативы — соседние результаты (для текстового поиска — из сырой выдачи TKS,
   * ставки им не нужны), по клику лендинг повторяет запрос с `code`.
   */
  private pickCandidate(search: TnVedSearchResponse): {
    rates: TnVedRateInfo;
    code: string;
    description: string;
    alternatives: { code: string; description: string }[];
  } | null {
    const detail = search.mode === 'code_lookup' ? search.codeDetail : search.results[0];
    if (!detail) return null;
    const altSource =
      search.mode === 'code_lookup'
        ? search.results.map((r) => ({ code: r.code, description: r.description }))
        : (search.rawTks?.search?.data ?? []).map((i) => ({
            code: i.CODE,
            description: i.KR_NAIM,
          }));
    return {
      rates: detail.rates,
      code: detail.code,
      description: detail.description,
      alternatives: altSource
        .filter((a) => a.code !== detail.code)
        .slice(0, MAX_ALTERNATIVES),
    };
  }

  /**
   * Один ClassifiedProduct для CalculatorService из пользовательских итогов по партии:
   * price/weight делятся на quantity, чтобы формула pipeline (price × quantity,
   * weight × quantity) вернула введённые значения.
   */
  private buildProduct(
    dto: EstimateDto,
    quantity: number,
    picked: { rates: TnVedRateInfo; code: string; description: string },
  ): ClassifiedProduct {
    const r = picked.rates;
    return {
      description: dto.query,
      quantity,
      price: dto.price / quantity,
      weight: (dto.weight ?? 0) / quantity,
      tnVedCode: picked.code,
      tnVedDescription: picked.description,
      dutyRate: r.dutyRate,
      dutyRateUnit: r.dutyRateUnit,
      dutySign: r.dutySign,
      dutyMin: r.dutyMin,
      dutyMinUnit: r.dutyMinUnit,
      vatRate: r.vatRate,
      exciseRate: r.exciseRate,
      // Код взят напрямую из справочника — «уверенность» здесь не про качество
      // классификации, а чтобы калькулятор не добавлял review-ноты.
      matchConfidence: 1,
      matched: true,
      verified: true,
      suggestedCode: null,
      verificationComment: '',
      notes: [],
    };
  }

  /** Fixed-window лимит по IP — тот же механизм, что у логина и загрузок кабинета. */
  private async assertRateLimit(ip: string): Promise<void> {
    await assertFixedWindowLimit(this.redis, this.logger, {
      key: `${RATE_KEY_PREFIX}${ip}`,
      windowSeconds: RATE_WINDOW_SECONDS,
      limit: hourlyLimit(),
      errorCode: ErrorCode.CALC_RATE_LIMITED,
      message: 'Лимит запросов исчерпан — попробуйте позже или пришлите файл в Telegram-бот',
    });
  }
}
