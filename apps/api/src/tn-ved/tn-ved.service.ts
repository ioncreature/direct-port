import Anthropic from '@anthropic-ai/sdk';
import {
  Priznak,
  TksApiClient,
  type GoodsItem,
  type GoodsSearchResponse,
  type TnvedCode,
  type TnvedallEntry,
  type TnvedRates,
} from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfigService } from '../ai-config/ai-config.service';
import { CLAUDE_TIMEOUT_UI_MS, extractClaudeText } from '../common/claude';
import { errMsg } from '../common/errors';
import { normalizeImpediUnit } from '../common/normalize-impedi';
import { normalizeOksmtCode } from '../common/oksmt';
import { modelFamily } from '../common/token-usage';
import { CountriesService } from '../countries/countries.service';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';
import { RegulatoryInterpreterService } from '../regulatory/regulatory-interpreter.service';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import type { RegulatoryExplanation, RegulatoryReport } from '../regulatory/interfaces';

export interface TnVedRateInfo {
  dutyRate: number;
  /** Единица IMP: null или "%" → dutyRate это адвалорный процент; "EUR/..." → специфическая ставка за единицу */
  dutyRateUnit: string | null;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
  /** Единица AKC: null/"%" → exciseRate адвалорный %; "RUB/л", "EUR/тыс.шт" → специфический акциз */
  exciseRateUnit: string | null;
  exciseSign: string | null;
  exciseMin: number | null;
  exciseMinUnit: string | null;
}

/**
 * Дополнительные (не-основные) ставки пошлин из TNVED.
 * Значения null если соответствующее поле отсутствует или равно 0.
 */
export interface TnVedExtendedRates {
  /** Временная пошлина (IMPTMP/IMPTMPEDI) */
  tempDuty: number | null;
  tempDutyUnit: string | null;
  /** Антидемпинговая (summary — обычно 0, если ставки дифференцированы по странам, см. countryDuties) */
  antidumpingDuty: number | null;
  antidumpingDutyUnit: string | null;
  /** Компенсационная */
  compensatoryDuty: number | null;
  compensatoryDutyUnit: string | null;
  /** Дополнительная импортная */
  additionalDuty: number | null;
  /** Дополнительные единицы измерения (EDI2, EDI3 нормализованные) */
  additionalUnits: string[];
}

export type TnVedCountryDutyKind = 'antidumping' | 'compensatory' | 'preferential';

/**
 * Ставка, действующая только для определённой страны происхождения.
 * Разворачивается из TNVEDALL с PRIZNAK=19 (антидемпинг), 20 (компенсационная), 30 (преференция по стране).
 */
export interface TnVedCountryDuty {
  kind: TnVedCountryDutyKind;
  countryCode: string | null;
  countryName: string | null;
  rate: number | null;
  rateUnit: string | null;
  sign: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  note: string | null;
}

/**
 * Условная акцизная ставка из TNVEDALL с PRIZNAK=2.
 * Тут лежат актуальные/новые ставки, которые ещё не попали в плоское TNVED.AKC,
 * а также ставки с периодами действия и ссылками на нормативные документы.
 */
export interface TnVedConditionalExcise {
  rate: number | null;
  /** Единица ставки — нормализованный TYPEMIN ("RUB/л", "EUR/тыс.шт", "%") */
  rateUnit: string | null;
  sign: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  note: string | null;
}

/** Пример реальной декларации: конкретное наименование товара, задекларированного по этому коду. */
export interface TnVedDeclarationExample {
  description: string;
  count: number;
}

export interface TnVedSearchResultItem {
  code: string;
  description: string;
  count: number;
  rates: TnVedRateInfo;
}

export interface TnVedCodeDetail {
  code: string;
  description: string;
  rates: TnVedRateInfo;
  extendedRates: TnVedExtendedRates;
  countryDuties: TnVedCountryDuty[];
  conditionalExcises: TnVedConditionalExcise[];
  declarations: TnVedDeclarationExample[];
  /** Разрешительные меры (сертификация, лицензии, маркировка, утильсбор, страновые запреты). */
  regulatoryReport: RegulatoryReport;
  dateBegin?: string;
  dateEnd?: string;
  notes?: string;
}

export interface TnVedRawTks {
  search?: GoodsSearchResponse;
  code?: TnvedCode;
  related?: GoodsSearchResponse;
  declarations?: GoodsSearchResponse;
  codes: Record<string, TnvedCode>;
}

export interface TnVedSearchResponse {
  mode: 'code_lookup' | 'text_search';
  query: string;
  translatedQuery?: string;
  codeDetail?: TnVedCodeDetail;
  results: TnVedSearchResultItem[];
  totalFound: number;
  rawTks?: TnVedRawTks;
}

const ENRICH_CONCURRENCY = 5;
const TRANSLATION_CACHE_TTL_MS = 3600_000;
const TRANSLATION_CACHE_MAX = 500;

@Injectable()
export class TnVedService {
  private logger = new Logger(TnVedService.name);
  private translationCache = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    @InjectRepository(TnVedCode) private tnVedRepo: Repository<TnVedCode>,
    @InjectRepository(AiUsageLog) private aiUsageLogRepo: Repository<AiUsageLog>,
    private tksApi: TksApiClient,
    private countriesService: CountriesService,
    private aiConfig: AiConfigService,
    private regulatoryService: RegulatoryRequirementsService,
    private regulatoryInterpreter: RegulatoryInterpreterService,
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
  ) {}

  async searchTks(query: string): Promise<TnVedSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { mode: 'text_search', query: '', results: [], totalFound: 0 };
    }

    if (this.isCodeQuery(trimmed)) {
      try {
        return await this.lookupCode(trimmed);
      } catch (err) {
        this.logger.warn(
          `Code lookup failed for "${trimmed}", falling back to text search: ${errMsg(err)}`,
        );
        return this.searchByText(trimmed);
      }
    }

    return this.searchByText(trimmed);
  }

  /**
   * Lazy-load AI-выжимок для разрешительных мер (вызывается из endpoint'а
   * /tn-ved/:code/regulatory-explanations). Возвращает Record<itemId, explanation>.
   * Записи с одинаковым NOTE-текстом получают одну выжимку, но разворачиваются
   * на каждый item.id внутри RegulatoryInterpreterService.
   */
  async getRegulatoryExplanations(
    code: string,
    language?: string,
  ): Promise<Record<string, RegulatoryExplanation>> {
    const normalized = this.normalizeCode(code);
    const tnved = await this.tksApi.getTnvedCode(normalized);
    const report = await this.regulatoryService.buildReport(tnved);
    const items = RegulatoryRequirementsService.flattenReport(report);
    if (items.length === 0) return {};

    const result = await this.regulatoryInterpreter.explain(items, language ?? 'ru');
    return Object.fromEntries(result.byId);
  }

  /** Поиск по локальной БД (обратная совместимость). */
  async search(query: string) {
    return this.tnVedRepo
      .createQueryBuilder('t')
      .where('t.code LIKE :q', { q: `${query}%` })
      .orWhere('t.description ILIKE :desc', { desc: `%${query}%` })
      .orderBy('t.code', 'ASC')
      .limit(50)
      .getMany();
  }

  async findByCode(code: string) {
    return this.tnVedRepo.findOne({ where: { code } });
  }

  private isCodeQuery(query: string): boolean {
    const cleaned = query.replace(/[\s.]/g, '');
    return /^\d{4,10}$/.test(cleaned);
  }

  private normalizeCode(query: string): string {
    const cleaned = query.replace(/[\s.]/g, '');
    return cleaned.padEnd(10, '0');
  }

  private async searchByText(query: string): Promise<TnVedSearchResponse> {
    const translatedQuery = await this.translateToRussian(query);
    const searchResult = await this.tksApi.searchGoodsGrouped(translatedQuery);

    const rawCodes: Record<string, TnvedCode> = {};
    const rawTks: TnVedRawTks = { search: searchResult, codes: rawCodes };

    if (!searchResult.data.length) {
      return {
        mode: 'text_search',
        query,
        translatedQuery: translatedQuery !== query ? translatedQuery : undefined,
        results: [],
        totalFound: 0,
        rawTks,
      };
    }

    const results = await this.enrichWithRates(searchResult.data, rawCodes);

    return {
      mode: 'text_search',
      query,
      translatedQuery: translatedQuery !== query ? translatedQuery : undefined,
      results,
      totalFound: searchResult.hm,
      rawTks,
    };
  }

  private async lookupCode(query: string): Promise<TnVedSearchResponse> {
    const code = this.normalizeCode(query);
    const tnved = await this.tksApi.getTnvedCode(code);

    const rawCodes: Record<string, TnvedCode> = {};
    const rawTks: TnVedRawTks = { code: tnved, codes: rawCodes };

    const [related, declData, countryDuties, regulatoryReport] = await Promise.all([
      this.tksApi.searchGoodsGrouped(tnved.KR_NAIM).catch(() => null),
      this.tksApi.searchGoodsByCode(tnved.KR_NAIM, code).catch(() => null),
      this.extractCountryDuties(tnved),
      this.regulatoryService.buildReport(tnved),
    ]);

    let examples: TnVedSearchResultItem[] = [];
    if (related) {
      rawTks.related = related;
      const filtered = related.data.filter((item) => item.CODE !== code).slice(0, 10);
      examples = await this.enrichWithRates(filtered, rawCodes);
    }

    let declarations: TnVedDeclarationExample[] = [];
    if (declData) {
      rawTks.declarations = declData;
      declarations = declData.data
        .slice(0, 15)
        .map((item) => ({ description: item.KR_NAIM, count: item.CNT }));
    }

    return {
      mode: 'code_lookup',
      query,
      codeDetail: {
        code: tnved.CODE,
        description: tnved.KR_NAIM,
        rates: this.extractRates(tnved),
        extendedRates: this.extractExtendedRates(tnved),
        countryDuties,
        conditionalExcises: this.extractConditionalExcises(tnved),
        declarations,
        regulatoryReport,
        dateBegin: tnved.DBEGIN ?? undefined,
        dateEnd: tnved.DEND ?? undefined,
        notes: tnved.PRIM != null ? String(tnved.PRIM) : undefined,
      },
      results: examples,
      totalFound: examples.length,
      rawTks,
    };
  }

  private async translateToRussian(query: string): Promise<string> {
    if (!this.anthropic) return query;
    if (this.isCyrillic(query)) return query;

    const cacheKey = query.trim().toLowerCase();
    const cached = this.translationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const model = await this.aiConfig.getQueryFormulationModel();
    try {
      const response = await this.anthropic.messages.create(
        {
          model,
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: `Переведи на русский язык следующий поисковый запрос для таможенного справочника. Верни ТОЛЬКО перевод, без пояснений.\n\nЗапрос: ${query}`,
            },
          ],
        },
        { timeout: CLAUDE_TIMEOUT_UI_MS },
      );

      this.aiUsageLogRepo
        .save({
          model: modelFamily(model),
          purpose: 'translate',
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        })
        .catch((err) => this.logger.warn('Failed to log translate token usage', err));

      const translated = extractClaudeText(response).trim() || query;
      this.cacheTranslation(cacheKey, translated);
      return translated;
    } catch (err) {
      this.logger.warn(
        `Translation failed, using original query: ${errMsg(err)}`,
      );
      return query;
    }
  }

  private cacheTranslation(key: string, value: string): void {
    if (this.translationCache.size >= TRANSLATION_CACHE_MAX) {
      const oldest = this.translationCache.keys().next().value;
      if (oldest !== undefined) this.translationCache.delete(oldest);
    }
    this.translationCache.set(key, { value, expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS });
  }

  private isCyrillic(text: string): boolean {
    const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '');
    if (!letters) return false;
    const cyrillic = letters.replace(/[^а-яА-ЯёЁ]/g, '').length;
    return cyrillic / letters.length > 0.5;
  }

  private async enrichWithRates(
    items: GoodsItem[],
    rawCodes: Record<string, TnvedCode>,
  ): Promise<TnVedSearchResultItem[]> {
    const results: TnVedSearchResultItem[] = new Array(items.length);

    for (let i = 0; i < items.length; i += ENRICH_CONCURRENCY) {
      const batch = items.slice(i, i + ENRICH_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const tnved = await this.tksApi.getTnvedCode(item.CODE);
            rawCodes[item.CODE] = tnved;
            return {
              code: item.CODE,
              description: item.KR_NAIM,
              count: item.CNT,
              rates: this.extractRates(tnved),
            };
          } catch {
            return {
              code: item.CODE,
              description: item.KR_NAIM,
              count: item.CNT,
              rates: {
                dutyRate: 0,
                dutyRateUnit: null,
                dutySign: null,
                dutyMin: null,
                dutyMinUnit: null,
                vatRate: 20,
                exciseRate: 0,
                exciseRateUnit: null,
                exciseSign: null,
                exciseMin: null,
                exciseMinUnit: null,
              },
            };
          }
        }),
      );
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  private extractRates(tnved: TnvedCode): TnVedRateInfo {
    const rates = tnved.TNVED ?? {};
    return {
      dutyRate: rates.IMP ?? 0,
      dutyRateUnit: normalizeImpediUnit(rates.IMPEDI),
      dutySign: rates.IMPSIGN ?? null,
      dutyMin: rates.IMP2 ?? null,
      dutyMinUnit: normalizeImpediUnit(rates.IMPEDI2),
      vatRate: rates.NDS ?? 20,
      exciseRate: rates.AKC ?? 0,
      exciseRateUnit: normalizeImpediUnit(rates.AKCEDI),
      exciseSign: rates.AKCSIGN ?? null,
      exciseMin: rates.AKC2 ?? null,
      exciseMinUnit: normalizeImpediUnit(rates.AKCEDI2),
    };
  }

  private extractExtendedRates(tnved: TnvedCode): TnVedExtendedRates {
    const rates: TnvedRates = tnved.TNVED ?? {};
    const additionalUnits: string[] = [];
    for (const raw of [rates.EDI2, rates.EDI3]) {
      const normalized = normalizeImpediUnit(raw);
      if (normalized && normalized !== '%' && !additionalUnits.includes(normalized)) {
        additionalUnits.push(normalized);
      }
    }

    return {
      tempDuty: nonZero(rates.IMPTMP),
      tempDutyUnit: normalizeImpediUnit(rates.IMPTMPEDI),
      antidumpingDuty: nonZero(rates.IMPDEMP),
      antidumpingDutyUnit: normalizeImpediUnit(rates.IMPDEMPEDI),
      compensatoryDuty: nonZero(rates.IMPCOMP),
      compensatoryDutyUnit: normalizeImpediUnit(rates.IMPCOMPEDI),
      additionalDuty: nonZero(rates.IMPDOP),
      additionalUnits,
    };
  }

  /**
   * Разворачивает TNVEDALL по PRIZNAK 19/20/30 в список ставок по странам.
   * Резолвит CU (OKSMT-код) в название страны через CountriesService.
   */
  private async extractCountryDuties(tnved: TnvedCode): Promise<TnVedCountryDuty[]> {
    const conditions = tnved.TNVEDALL;
    if (!conditions) return [];

    const groups: Array<{ kind: TnVedCountryDutyKind; entries: TnvedallEntry[] }> = [];
    for (const [key, entries] of Object.entries(conditions)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const kind = priznakToCountryDutyKind(Number(key));
      if (!kind) continue;
      groups.push({ kind, entries });
    }

    if (groups.length === 0) return [];

    const allCodes = new Set<string>();
    for (const g of groups) {
      for (const e of g.entries) {
        const n = normalizeOksmtCode(e.CU);
        if (n) allCodes.add(n);
      }
    }

    const countryNames = new Map<string, string>();
    await Promise.all(
      Array.from(allCodes).map(async (c) => {
        try {
          const country = await this.countriesService.findByCode(c);
          if (country) countryNames.set(c, country.nameRu);
        } catch (err) {
          this.logger.warn(`Country lookup failed for ${c}: ${errMsg(err)}`);
        }
      }),
    );

    const result: TnVedCountryDuty[] = [];
    for (const { kind, entries } of groups) {
      for (const e of entries) {
        const countryCode = normalizeOksmtCode(e.CU);
        result.push({
          kind,
          countryCode,
          countryName: countryCode ? countryNames.get(countryCode) ?? null : null,
          rate: e.MIN ?? null,
          rateUnit: normalizeImpediUnit(e.TYPEMIN) ?? '%',
          sign: e.SIGN ?? null,
          dateBegin: e.DBEGIN ?? null,
          dateEnd: e.DEND ?? null,
          documentNumber: e.DOC_N ?? null,
          documentDate: e.DOC_D ?? null,
          note: e.NOTE ?? null,
        });
      }
    }

    return result;
  }

  /**
   * Разворачивает TNVEDALL[2] (PRIZNAK=2 — акциз) в список условных акцизных ставок.
   * Там лежат актуальные/новые ставки с периодами действия (DBEGIN/DEND) и ссылками
   * на нормативные документы, которые могут отсутствовать в плоском TNVED.AKC.
   */
  private extractConditionalExcises(tnved: TnvedCode): TnVedConditionalExcise[] {
    const entries = tnved.TNVEDALL?.[String(Priznak.Excise)];
    if (!entries || entries.length === 0) return [];

    return entries.map((e) => ({
      rate: e.MIN ?? null,
      rateUnit: normalizeImpediUnit(e.TYPEMIN),
      sign: e.SIGN ?? null,
      dateBegin: e.DBEGIN ?? null,
      dateEnd: e.DEND ?? null,
      documentNumber: e.DOC_N ?? null,
      documentDate: e.DOC_D ?? null,
      note: e.NOTE ?? null,
    }));
  }
}

function nonZero(value: number | undefined | null): number | null {
  if (value == null) return null;
  return value === 0 ? null : value;
}

function priznakToCountryDutyKind(priznak: number): TnVedCountryDutyKind | null {
  if (priznak === Priznak.AntidumpingDuty) return 'antidumping';
  if (priznak === Priznak.CompensatoryDuty) return 'compensatory';
  if (priznak === Priznak.CountryImportDuty) return 'preferential';
  return null;
}
