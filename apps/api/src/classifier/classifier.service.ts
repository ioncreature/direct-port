import Anthropic from '@anthropic-ai/sdk';
import {
  TksApiClient,
  calcProbability,
  type GoodsItem,
  type TnvedCode,
} from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { cacheTools, extractToolInput, systemPrompt } from '../common/claude';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../common/confidence';
import { errMsg } from '../common/errors';
import { normalizeImpediUnit } from '../common/normalize-impedi';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import {
  emptyTokenUsageMap,
  mergeTokenUsage,
  tokenUsageFromResponse,
  type TokenUsageMap,
} from '../common/token-usage';
import type { Dimension } from '../duty-interpreter/interfaces';

/**
 * Вход классификатора. Содержит минимум для поиска в TKS + опциональные
 * размеры (площадь/объём/штуки) и заметки от предыдущих этапов (парсер).
 */
export interface ProductRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  dimensions?: Dimension[];
  notes?: ProductNote[];
  hsCode?: string;
  rawContext?: string;
}

export interface ClassifiedProduct extends ProductRow {
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  /** Единица IMP: null/"%" → dutyRate адвалорный процент; "EUR/..." → специфическая ставка EUR за единицу */
  dutyRateUnit: string | null;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
  matchConfidence: number;
  matched: boolean;
  tnvedRaw?: TnvedCode;
  verified: boolean;
  suggestedCode: string | null;
  verificationComment: string;
  notes: ProductNote[];
}

/**
 * Alias для обратной совместимости. Раньше Verification был отдельным шагом,
 * теперь classify+verify объединены в ClassifierService.
 */
export type VerifiedProduct = ClassifiedProduct;

interface TksCandidate {
  code: string;
  name: string;
  confidence: number;
}

interface ClaudeSelection {
  index: number;
  tnVedCode: string;
  confidence: number;
  comment: string;
  comment_localized?: string;
  fromCandidates: boolean;
}

interface ClassifyItem {
  index: number;
  description: string;
  candidates: TksCandidate[];
  rawContext?: string;
  hsCode?: string;
  hsCodeValid?: boolean;
}

const SEARCH_CONCURRENCY = 5;
const CLAUDE_BATCH_SIZE = 20;
const CLAUDE_CONCURRENCY = 2;
const MAX_CANDIDATES = 5;
const QUERIES_PER_PRODUCT = 5;
const CLASSIFICATION_CACHE_TTL = 86_400_000; // 24 hours
const CLASSIFICATION_CACHE_MAX = 1000;

const SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации товаров по ТН ВЭД (Товарная номенклатура внешнеэкономической деятельности ЕАЭС).

Для каждого товара тебе предоставлены описание, контекст (rawContext: материал, характеристики и т.д.) и кандидаты из справочника TKS с оценкой релевантности.

Задача — выбрать наиболее подходящий 10-значный код ТН ВЭД.

Правила:
- Если один из кандидатов TKS подходит — выбери его (fromCandidates: true)
- Если ни один кандидат не подходит — предложи более точный 10-значный код (fromCandidates: false)
- Если кандидатов нет — предложи код на основе описания товара и контекста
- Если описание слишком расплывчатое для точной классификации — выбери наиболее вероятный и укажи это в comment
- Используй rawContext (материал, характеристики) для уточнения классификации. Материал часто определяет группу ТН ВЭД
- Если указан hsCode (код от автора файла) — это предложенный код. Проверь его соответствие описанию и контексту. Если подходит — подтверди (fromCandidates: false, высокий confidence). Если не подходит — выбери правильный код и объясни в comment почему предложенный не подходит
- confidence: 0.0-1.0 — твоя уверенность в выбранном коде
- comment: краткое пояснение выбора на русском
`;

const CLASSIFY_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_products',
  description: 'Результаты классификации товаров по ТН ВЭД',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            tnVedCode: { type: 'string', description: '10-значный код ТН ВЭД' },
            confidence: { type: 'number', description: '0.0-1.0' },
            comment: { type: 'string', description: 'Пояснение на русском' },
            comment_localized: { type: 'string', description: 'Пояснение на языке пользователя' },
            fromCandidates: { type: 'boolean' },
          },
          required: ['index', 'tnVedCode', 'confidence', 'comment', 'fromCandidates'],
        },
      },
    },
    required: ['items'],
  },
};

const QUERY_FORMULATION_SYSTEM = `Ты — эксперт по таможенному оформлению. Для каждого товара сформулируй ${QUERIES_PER_PRODUCT} коротких поисковых запросов для поиска в базе реальных таможенных деклараций.

ВАЖНО: Поиск работает по заголовкам реальных деклараций. Он НЕ поддерживает склонения и морфологию. Чем больше слов в запросе — тем меньше шансов найти совпадение.

Правила:
- Каждый запрос: 2-3 слова, максимум 4 в исключительных случаях. 5 слов — НИКОГДА
- ${QUERIES_PER_PRODUCT} запросов должны покрывать разные аспекты товара
- Обязательно включи запрос с основным МАТЕРИАЛОМ (пластмасса, сталь, хлопок, медь и т.д.) если он известен
- Используй таможенную терминологию (ИЗДЕЛИЯ, ЧАСТИ, ПРИНАДЛЕЖНОСТИ)
- Убери бренды и маркетинговые слова
- Запросы должны отличаться друг от друга

Стратегия формулирования:
1. ТИП товара (общее название)
2. МАТЕРИАЛ + ТИП
3. НАЗНАЧЕНИЕ или ХАРАКТЕРИСТИКА
4. Синоним или альтернативное название
5. Более узкий или широкий термин

Примеры:
- "Музыкальная детская игрушка" + context "АБС-пластик; батарейка" → ["ИГРУШКА МУЗЫКАЛЬНАЯ", "ИГРУШКА ПЛАСТМАССА", "ИГРУШКА ДЕТСКАЯ", "ИГРУШКА ЗВУКОВАЯ", "ИЗДЕЛИЕ ПЛАСТМАССА ДЕТСКОЕ"]
- "Электрический чайник Xiaomi 1.5л" + context "нержавеющая сталь; 1500 Вт" → ["ЧАЙНИК ЭЛЕКТРИЧЕСКИЙ", "ЧАЙНИК СТАЛЬ", "ЭЛЕКТРОПРИБОР КУХОННЫЙ", "ЧАЙНИК НЕРЖАВЕЮЩАЯ", "ПРИБОР НАГРЕВАТЕЛЬНЫЙ"]
- "Кабель USB Type-C 1м" + context "медь; в оплётке" → ["КАБЕЛЬ МЕДНЫЙ", "ПРОВОД ЭЛЕКТРИЧЕСКИЙ", "КАБЕЛЬ РАЗЪЁМ", "ПРОВОД МЕДНЫЙ", "КАБЕЛЬ СОЕДИНИТЕЛЬНЫЙ"]
`;

const FORMULATE_QUERIES_TOOL: Anthropic.Messages.Tool = {
  name: 'formulate_search_queries',
  description: 'Поисковые запросы в стиле таможенных деклараций',
  input_schema: {
    type: 'object' as const,
    properties: {
      products: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            queries: {
              type: 'array',
              items: { type: 'string' },
              description: `${QUERIES_PER_PRODUCT} коротких поисковых запросов по 2-3 слова`,
            },
          },
          required: ['index', 'queries'],
        },
      },
    },
    required: ['products'],
  },
};

@Injectable()
export class ClassifierService {
  private logger = new Logger(ClassifierService.name);
  private classificationCache = new Map<string, { data: ClaudeSelection; expiresAt: number }>();

  constructor(
    private tksApi: TksApiClient,
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private aiConfig: AiConfigService,
  ) {}

  async classify(
    products: ProductRow[],
    language?: string,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  ): Promise<{ products: ClassifiedProduct[]; tokenUsage: TokenUsageMap }> {
    this.logger.log(
      `Classifying ${products.length} products${language ? `, language=${language}` : ''}, threshold=${confidenceThreshold}`,
    );
    // Deduplication: classify unique descriptions+context only, map results back
    const dedupMap = new Map<string, number>();
    const uniqueProducts: ProductRow[] = [];
    const originalToUnique: number[] = [];

    for (let i = 0; i < products.length; i++) {
      const key = this.buildProductKey(products[i]);
      let uniqueIdx = dedupMap.get(key);
      if (uniqueIdx === undefined) {
        uniqueIdx = uniqueProducts.length;
        dedupMap.set(key, uniqueIdx);
        uniqueProducts.push(products[i]);
      }
      originalToUnique.push(uniqueIdx);
    }

    if (uniqueProducts.length < products.length) {
      this.logger.log(
        `Deduplication: ${products.length} products → ${uniqueProducts.length} unique`,
      );
    }

    // Phase 0: Validate author-provided HS codes + formulate search queries (parallel)
    const [validatedHsCodes, { queries: searchQueries, tokenUsage: queryTokenUsage }] =
      await Promise.all([
        this.validateHsCodes(uniqueProducts),
        this.formulateSearchQueries(uniqueProducts),
      ]);
    let tokenUsage = queryTokenUsage;

    // Phase 1: TKS search — top-N candidates using declaration-style queries
    const uniqueCandidates = await this.searchAll(searchQueries);

    // Phase 2: Claude classify+verify with result caching
    const uniqueSelections: (ClaudeSelection | null)[] = new Array(uniqueProducts.length).fill(
      null,
    );

    const classifierModel = await this.aiConfig.getClassifierModel();
    const uncached: { idx: number; product: ProductRow; candidates: TksCandidate[] }[] = [];
    const now = Date.now();
    for (let i = 0; i < uniqueProducts.length; i++) {
      const cacheKey = this.buildProductKey(uniqueProducts[i], classifierModel);
      const cached = this.classificationCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        uniqueSelections[i] = cached.data;
      } else {
        uncached.push({ idx: i, product: uniqueProducts[i], candidates: uniqueCandidates[i] });
      }
    }

    const cacheHits = uniqueProducts.length - uncached.length;
    if (cacheHits > 0) {
      this.logger.log(`Classification cache: ${cacheHits} hits, ${uncached.length} misses`);
    }

    if (this.anthropic && uncached.length > 0) {
      const validatedHsCodeSet = new Set([...validatedHsCodes.values()].map((t) => t.CODE));
      const result = await this.classifyWithClaude(
        uncached.map((u) => u.product),
        uncached.map((u) => u.candidates),
        validatedHsCodeSet,
        language,
      );
      tokenUsage = mergeTokenUsage(tokenUsage, result.tokenUsage);

      for (let i = 0; i < uncached.length; i++) {
        const sel = result.selections[i];
        uniqueSelections[uncached[i].idx] = sel;
        if (sel) {
          const cacheKey = this.buildProductKey(uncached[i].product, classifierModel);
          this.classificationCache.set(cacheKey, {
            data: sel,
            expiresAt: now + CLASSIFICATION_CACHE_TTL,
          });
        }
      }
      this.evictExpiredCache();
    } else if (!this.anthropic) {
      this.logger.warn('ANTHROPIC_API_KEY not set, using TKS-only classification');
    }

    // Map back to original products
    const candidatesByProduct = products.map((_, i) => uniqueCandidates[originalToUnique[i]]);
    const selections = products.map((_, i) => uniqueSelections[originalToUnique[i]]);

    // Phase 3: Load TNVED rates — pre-seed with validated HS codes to avoid duplicate fetches
    const tnvedByCode = new Map<string, TnvedCode>();
    for (const tnved of validatedHsCodes.values()) {
      tnvedByCode.set(tnved.CODE, tnved);
    }
    const codesToLoad = new Set<string>();
    for (let i = 0; i < products.length; i++) {
      const sel = selections[i];
      const code = sel?.tnVedCode || candidatesByProduct[i]?.[0]?.code;
      if (code && !tnvedByCode.has(code)) codesToLoad.add(code);
    }
    const loadedRates = await this.loadTnvedRates([...codesToLoad]);
    for (const [code, tnved] of loadedRates) {
      tnvedByCode.set(code, tnved);
    }

    // Phase 4: Assemble results
    const assembled = this.assembleResults(
      products,
      candidatesByProduct,
      selections,
      tnvedByCode,
      language,
      confidenceThreshold,
    );
    const matched = assembled.filter((p) => p.matched).length;
    this.logger.log(
      `Classification done: ${matched}/${assembled.length} matched, ${codesToLoad.size} unique codes`,
    );
    return { products: assembled, tokenUsage };
  }

  private buildProductKey(p: ProductRow, model?: string): string {
    const parts = [
      p.description.trim().toLowerCase(),
      p.rawContext?.trim().toLowerCase() ?? '',
      p.hsCode ?? '',
    ];
    if (model) parts.push(model);
    return parts.join('\x1F');
  }

  private evictExpiredCache(): void {
    if (this.classificationCache.size <= CLASSIFICATION_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this.classificationCache) {
      if (entry.expiresAt <= now) this.classificationCache.delete(key);
    }
  }

  // --- Phase 0: HS Code Validation ---

  private async validateHsCodes(products: ProductRow[]): Promise<Map<string, TnvedCode>> {
    const codes = [
      ...new Set(
        products.map((p) => p.hsCode).filter((c): c is string => !!c && /^\d{10}$/.test(c)),
      ),
    ];
    if (codes.length === 0) return new Map();

    const validated = await this.loadTnvedRates(codes);
    const failed = codes.length - validated.size;
    if (failed > 0) {
      this.logger.warn(`${failed}/${codes.length} author-provided HS codes not found in reference`);
    }
    if (validated.size > 0) {
      this.logger.log(`Validated ${validated.size}/${codes.length} author-provided HS codes`);
    }
    return validated;
  }

  // --- Phase 0.5: Search Query Formulation ---

  private async formulateSearchQueries(
    products: ProductRow[],
  ): Promise<{ queries: string[][]; tokenUsage: TokenUsageMap }> {
    if (!this.anthropic || products.length === 0) {
      return { queries: products.map((p) => [p.description]), tokenUsage: emptyTokenUsageMap() };
    }

    const items = products.map((p, i) => ({
      index: i,
      description: p.description,
      ...(p.rawContext ? { context: p.rawContext } : {}),
    }));

    const model = await this.aiConfig.getQueryFormulationModel();

    try {
      const response = await this.anthropic.messages.create(
        {
          model,
          max_tokens: 16384,
          system: systemPrompt(QUERY_FORMULATION_SYSTEM),
          messages: [{ role: 'user', content: JSON.stringify(items) }],
          tools: [FORMULATE_QUERIES_TOOL],
          tool_choice: { type: 'any' },
        },
        { timeout: 45_000 },
      );

      const result = extractToolInput<{ products: Array<{ index: number; queries: string[] }> }>(
        response,
      );
      const queryMap = new Map(result.products.map((p) => [p.index, p.queries]));
      const queries = products.map((p, i) => queryMap.get(i) ?? [p.description]);

      this.logger.log(
        `Formulated ${queryMap.size}×${QUERIES_PER_PRODUCT} search queries via ${model}`,
      );
      return { queries, tokenUsage: tokenUsageFromResponse(model, response.usage) };
    } catch (err) {
      this.logger.warn(`Query formulation failed, using raw descriptions: ${errMsg(err)}`);
      return { queries: products.map((p) => [p.description]), tokenUsage: emptyTokenUsageMap() };
    }
  }

  // --- Phase 1: TKS Search (multiple queries per product) ---

  private async searchAll(queryGroups: string[][]): Promise<TksCandidate[][]> {
    const results: TksCandidate[][] = new Array(queryGroups.length);

    for (let i = 0; i < queryGroups.length; i += SEARCH_CONCURRENCY) {
      const batch = queryGroups.slice(i, i + SEARCH_CONCURRENCY);
      const batchResults = await Promise.all(batch.map((queries) => this.searchMulti(queries)));
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  private async searchMulti(queries: string[]): Promise<TksCandidate[]> {
    const allResults = await Promise.all(
      queries.map((query) =>
        this.tksApi.searchGoodsGrouped(query).catch((err) => {
          this.logger.warn(`TKS search failed for "${query}": ${errMsg(err)}`);
          return { data: [] as GoodsItem[], hm: 0 };
        }),
      ),
    );

    // Merge results: deduplicate by code, keep highest confidence
    const byCode = new Map<string, TksCandidate>();
    for (const result of allResults) {
      for (const item of result.data) {
        const confidence = calcProbability(item, result.hm);
        const existing = byCode.get(item.CODE);
        if (!existing || confidence > existing.confidence) {
          byCode.set(item.CODE, { code: item.CODE, name: item.KR_NAIM, confidence });
        }
      }
    }

    return [...byCode.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES);
  }

  // --- Phase 2: Claude Classify+Verify ---

  private async classifyWithClaude(
    products: ProductRow[],
    candidatesByProduct: TksCandidate[][],
    validatedHsCodes: Set<string>,
    language?: string,
  ): Promise<{ selections: (ClaudeSelection | null)[]; tokenUsage: TokenUsageMap }> {
    const allSelections: (ClaudeSelection | null)[] = new Array(products.length).fill(null);
    let totalUsage = emptyTokenUsageMap();

    const batches: ClassifyItem[][] = [];
    for (let i = 0; i < products.length; i += CLAUDE_BATCH_SIZE) {
      const batchEnd = Math.min(i + CLAUDE_BATCH_SIZE, products.length);
      const items: ClassifyItem[] = [];
      for (let j = i; j < batchEnd; j++) {
        const hsCode = products[j].hsCode;
        items.push({
          index: j,
          description: products[j].description,
          candidates: candidatesByProduct[j] ?? [],
          ...(products[j].rawContext ? { rawContext: products[j].rawContext } : {}),
          ...(hsCode ? { hsCode } : {}),
          ...(hsCode && validatedHsCodes.has(hsCode) ? { hsCodeValid: true } : {}),
        });
      }
      batches.push(items);
    }

    const useCache = batches.length > 1;

    if (batches.length > 0) {
      try {
        const { selections, tokenUsage } = await this.callClaude(batches[0], language, useCache);
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const sel of selections) {
          if (sel.index >= 0 && sel.index < products.length) {
            allSelections[sel.index] = sel;
          }
        }
      } catch (err) {
        this.logger.error('Claude classify+verify batch failed', err);
      }
    }

    // Remaining batches in parallel — prompt cache is warm
    const remaining = batches.slice(1);
    for (let g = 0; g < remaining.length; g += CLAUDE_CONCURRENCY) {
      const group = remaining.slice(g, g + CLAUDE_CONCURRENCY);
      const results = await Promise.all(
        group.map((items) =>
          this.callClaude(items, language, useCache).catch((err) => {
            this.logger.error('Claude classify+verify batch failed', err);
            return { selections: [] as ClaudeSelection[], tokenUsage: emptyTokenUsageMap() };
          }),
        ),
      );
      for (const { selections, tokenUsage } of results) {
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const sel of selections) {
          if (sel.index >= 0 && sel.index < products.length) {
            allSelections[sel.index] = sel;
          }
        }
      }
    }

    return { selections: allSelections, tokenUsage: totalUsage };
  }

  private async callClaude(
    items: ClassifyItem[],
    language?: string,
    useCache = false,
  ): Promise<{ selections: ClaudeSelection[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getClassifierModel();
    const needsLocalized = language && language !== 'ru';
    const localizedInstruction = needsLocalized
      ? `\nДополнительно: для каждого товара добавь comment_localized — пояснение на ${language === 'zh' ? 'китайском' : 'английском'} языке.`
      : '';

    const userPrompt = `Классифицируй товары по ТН ВЭД: ${JSON.stringify(items, null, 2)}${localizedInstruction}`;

    const response = await this.anthropic!.messages.create(
      {
        model,
        max_tokens: 4096,
        system: systemPrompt(SYSTEM_PROMPT),
        messages: [{ role: 'user', content: userPrompt }],
        tools: cacheTools([CLASSIFY_TOOL], useCache),
        tool_choice: { type: 'any' },
      },
      { timeout: 30_000 },
    );

    const result = extractToolInput<{ items: ClaudeSelection[] }>(response);
    return {
      selections: result.items,
      tokenUsage: tokenUsageFromResponse(model, response.usage),
    };
  }

  // --- Phase 3: Load TNVED Rates ---

  private async loadTnvedRates(codes: string[]): Promise<Map<string, TnvedCode>> {
    const map = new Map<string, TnvedCode>();
    for (let i = 0; i < codes.length; i += SEARCH_CONCURRENCY) {
      const batch = codes.slice(i, i + SEARCH_CONCURRENCY);
      await Promise.all(
        batch.map(async (code) => {
          try {
            map.set(code, await this.tksApi.getTnvedCode(code));
          } catch (err) {
            this.logger.warn(`Failed to load TNVED for ${code}: ${errMsg(err)}`);
          }
        }),
      );
    }
    return map;
  }

  // --- Phase 4: Assemble Results ---

  private assembleResults(
    products: ProductRow[],
    candidatesByProduct: TksCandidate[][],
    selections: (ClaudeSelection | null)[],
    tnvedByCode: Map<string, TnvedCode>,
    language: string | undefined,
    confidenceThreshold: number,
  ): ClassifiedProduct[] {
    return products.map((product, i) => {
      const sel = selections[i];
      const candidates = candidatesByProduct[i] ?? [];
      const bestTks = candidates[0] ?? null;

      // Priority: Claude selection > best TKS candidate > unmatched
      const chosenCode = sel?.tnVedCode ?? bestTks?.code ?? '';
      const tnved = chosenCode ? tnvedByCode.get(chosenCode) : undefined;

      if (!chosenCode || !tnved) {
        return this.unmatched(product, sel, candidates);
      }

      const rates = tnved.TNVED ?? {};
      const notes: ProductNote[] = [...(product.notes ?? [])];

      const confidence = sel?.confidence ?? bestTks?.confidence ?? 0;
      const verified = sel != null;

      if (!verified) {
        notes.push({
          stage: 'classify',
          severity: 'warning',
          field: 'code',
          message:
            'AI-классификация недоступна, код выбран только по справочнику TKS. Рекомендуется проверка.',
          messageLocalized: getStaticNoteTranslation('verification-disabled', language),
        });
      } else if (confidence < confidenceThreshold) {
        notes.push({
          stage: 'classify',
          severity: 'warning',
          field: 'code',
          message: `Код ${chosenCode} выбран с невысокой уверенностью (${confidence.toFixed(2)}). ${sel.comment}`,
          messageLocalized: sel.comment_localized
            ? `Code ${chosenCode} selected with low confidence (${confidence.toFixed(2)}). ${sel.comment_localized}`
            : undefined,
        });
      } else if (sel.comment) {
        notes.push({
          stage: 'classify',
          severity: 'info',
          field: 'code',
          message: `Классификация: ${sel.comment}`,
          messageLocalized: sel.comment_localized
            ? `Classification: ${sel.comment_localized}`
            : undefined,
        });
      }

      const suggestedCode = sel && !sel.fromCandidates ? sel.tnVedCode : null;

      return {
        ...product,
        tnVedCode: tnved.CODE,
        tnVedDescription: tnved.KR_NAIM,
        dutyRate: rates.IMP ?? 0,
        dutyRateUnit: normalizeImpediUnit(rates.IMPEDI),
        dutySign: rates.IMPSIGN ?? null,
        dutyMin: rates.IMP2 ?? null,
        dutyMinUnit: normalizeImpediUnit(rates.IMPEDI2),
        vatRate: rates.NDS ?? 20,
        exciseRate: rates.AKC ?? 0,
        matchConfidence: confidence,
        matched: true,
        tnvedRaw: tnved,
        verified,
        suggestedCode,
        verificationComment: sel?.comment ?? '',
        notes,
      };
    });
  }

  private unmatched(
    product: ProductRow,
    sel: ClaudeSelection | null,
    candidates: TksCandidate[],
  ): ClassifiedProduct {
    const reason =
      candidates.length === 0
        ? 'TKS не вернул кандидатов, AI не смог предложить код'
        : sel
          ? `AI предложил код ${sel.tnVedCode}, но он не найден в справочнике`
          : 'Не удалось определить код ТН ВЭД';

    return {
      ...product,
      tnVedCode: '',
      tnVedDescription: 'Не найден',
      dutyRate: 0,
      dutyRateUnit: null,
      dutySign: null,
      dutyMin: null,
      dutyMinUnit: null,
      vatRate: 20,
      exciseRate: 0,
      matchConfidence: 0,
      matched: false,
      tnvedRaw: undefined,
      verified: false,
      suggestedCode: sel?.tnVedCode ?? null,
      verificationComment: sel?.comment ?? reason,
      notes: [
        ...(product.notes ?? []),
        {
          stage: 'classify',
          severity: 'blocker',
          field: 'code',
          message: `${reason}. Без кода ТН ВЭД расчёт пошлины и НДС невозможен.`,
        },
      ],
    };
  }
}
