import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, type GoodsItem, type TnvedCode } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extractClaudeText } from '../common/claude';
import { normalizeImpediUnit } from '../common/normalize-impedi';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';

export interface TnVedRateInfo {
  dutyRate: number;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
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
  dateBegin?: string;
  dateEnd?: string;
  notes?: string;
}

export interface TnVedSearchResponse {
  mode: 'code_lookup' | 'text_search';
  query: string;
  translatedQuery?: string;
  codeDetail?: TnVedCodeDetail;
  results: TnVedSearchResultItem[];
  totalFound: number;
}

const ENRICH_CONCURRENCY = 5;

@Injectable()
export class TnVedService {
  private logger = new Logger(TnVedService.name);

  constructor(
    @InjectRepository(TnVedCode) private tnVedRepo: Repository<TnVedCode>,
    private tksApi: TksApiClient,
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
          `Code lookup failed for "${trimmed}", falling back to text search: ${err instanceof Error ? err.message : err}`,
        );
        return this.searchByText(trimmed);
      }
    }

    return this.searchByText(trimmed);
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

    if (!searchResult.data.length) {
      return {
        mode: 'text_search',
        query,
        translatedQuery: translatedQuery !== query ? translatedQuery : undefined,
        results: [],
        totalFound: 0,
      };
    }

    const results = await this.enrichWithRates(searchResult.data);

    return {
      mode: 'text_search',
      query,
      translatedQuery: translatedQuery !== query ? translatedQuery : undefined,
      results,
      totalFound: searchResult.hm,
    };
  }

  private async lookupCode(query: string): Promise<TnVedSearchResponse> {
    const code = this.normalizeCode(query);
    const tnved = await this.tksApi.getTnvedCode(code);

    let examples: TnVedSearchResultItem[] = [];
    try {
      const related = await this.tksApi.searchGoodsGrouped(tnved.KR_NAIM);
      const filtered = related.data.filter((item) => item.CODE !== code).slice(0, 10);
      examples = await this.enrichWithRates(filtered);
    } catch {
      // Примеры — не критично
    }

    return {
      mode: 'code_lookup',
      query,
      codeDetail: {
        code: tnved.CODE,
        description: tnved.KR_NAIM,
        rates: this.extractRates(tnved),
        dateBegin: tnved.DBEGIN,
        dateEnd: tnved.DEND,
        notes: tnved.PRIM,
      },
      results: examples,
      totalFound: examples.length,
    };
  }

  private async translateToRussian(query: string): Promise<string> {
    if (!this.anthropic) return query;
    if (this.isCyrillic(query)) return query;

    try {
      const response = await this.anthropic.messages.create(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: `Переведи на русский язык следующий поисковый запрос для таможенного справочника. Верни ТОЛЬКО перевод, без пояснений.\n\nЗапрос: ${query}`,
            },
          ],
        },
        { timeout: 10_000 },
      );

      return extractClaudeText(response).trim() || query;
    } catch (err) {
      this.logger.warn(
        `Translation failed, using original query: ${err instanceof Error ? err.message : err}`,
      );
      return query;
    }
  }

  private isCyrillic(text: string): boolean {
    const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '');
    if (!letters) return false;
    const cyrillic = letters.replace(/[^а-яА-ЯёЁ]/g, '').length;
    return cyrillic / letters.length > 0.5;
  }

  private async enrichWithRates(items: GoodsItem[]): Promise<TnVedSearchResultItem[]> {
    const results: TnVedSearchResultItem[] = new Array(items.length);

    for (let i = 0; i < items.length; i += ENRICH_CONCURRENCY) {
      const batch = items.slice(i, i + ENRICH_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const tnved = await this.tksApi.getTnvedCode(item.CODE);
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
                dutySign: null,
                dutyMin: null,
                dutyMinUnit: null,
                vatRate: 20,
                exciseRate: 0,
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
      dutySign: rates.IMPSIGN ?? null,
      dutyMin: rates.IMP2 ?? null,
      dutyMinUnit: normalizeImpediUnit(rates.IMPEDI2),
      vatRate: rates.NDS ?? 20,
      exciseRate: rates.AKC ?? 0,
    };
  }
}
