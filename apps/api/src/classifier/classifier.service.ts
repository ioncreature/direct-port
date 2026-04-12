import Anthropic from '@anthropic-ai/sdk';
import {
  TksApiClient,
  calcProbability,
  type GoodsItem,
  type TnvedCode,
} from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { extractClaudeText, parseClaudeJson } from '../common/claude';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, tokenUsageFromResponse } from '../common/token-usage';
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
}

export interface ClassifiedProduct extends ProductRow {
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
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

const SEARCH_CONCURRENCY = 5;
const CLAUDE_BATCH_SIZE = 20;
const MAX_CANDIDATES = 5;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

const SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации товаров по ТН ВЭД (Товарная номенклатура внешнеэкономической деятельности ЕАЭС).

Для каждого товара тебе предоставлены описание и кандидаты из справочника TKS с оценкой релевантности.

Задача — выбрать наиболее подходящий 10-значный код ТН ВЭД.

Правила:
- Если один из кандидатов TKS подходит — выбери его (fromCandidates: true)
- Если ни один кандидат не подходит — предложи более точный 10-значный код (fromCandidates: false)
- Если кандидатов нет — предложи код на основе описания товара
- Если описание слишком расплывчатое для точной классификации — выбери наиболее вероятный и укажи это в comment
- confidence: 0.0-1.0 — твоя уверенность в выбранном коде
- comment: краткое пояснение выбора на русском
- Отвечай ТОЛЬКО валидным JSON-массивом, без markdown-обёртки`;

@Injectable()
export class ClassifierService {
  private logger = new Logger(ClassifierService.name);

  constructor(
    private tksApi: TksApiClient,
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private aiConfig: AiConfigService,
  ) {}

  async classify(
    products: ProductRow[],
    language?: string,
  ): Promise<{ products: ClassifiedProduct[]; tokenUsage: TokenUsageMap }> {
    // Deduplication: classify unique descriptions only, map results back
    const descToIndex = new Map<string, number>();
    const uniqueProducts: ProductRow[] = [];
    const originalToUnique: number[] = [];

    for (let i = 0; i < products.length; i++) {
      const key = products[i].description.trim().toLowerCase();
      let uniqueIdx = descToIndex.get(key);
      if (uniqueIdx === undefined) {
        uniqueIdx = uniqueProducts.length;
        descToIndex.set(key, uniqueIdx);
        uniqueProducts.push(products[i]);
      }
      originalToUnique.push(uniqueIdx);
    }

    if (uniqueProducts.length < products.length) {
      this.logger.log(
        `Deduplication: ${products.length} products → ${uniqueProducts.length} unique descriptions`,
      );
    }

    // Phase 1: TKS search — top-N candidates for each unique product
    const uniqueCandidates = await this.searchAll(uniqueProducts);

    // Phase 2: Claude classify+verify (or fallback to TKS-only)
    let uniqueSelections: (ClaudeSelection | null)[];
    let tokenUsage = emptyTokenUsageMap();
    if (this.anthropic) {
      const result = await this.classifyWithClaude(uniqueProducts, uniqueCandidates, language);
      uniqueSelections = result.selections;
      tokenUsage = result.tokenUsage;
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set, using TKS-only classification');
      uniqueSelections = uniqueProducts.map(() => null);
    }

    // Map back to original products
    const candidatesByProduct = products.map((_, i) => uniqueCandidates[originalToUnique[i]]);
    const selections = products.map((_, i) => uniqueSelections[originalToUnique[i]]);

    // Phase 3: Load TNVED rates for selected codes
    const codesToLoad = new Set<string>();
    for (let i = 0; i < products.length; i++) {
      const sel = selections[i];
      if (sel?.tnVedCode) {
        codesToLoad.add(sel.tnVedCode);
      } else {
        const top = candidatesByProduct[i]?.[0];
        if (top) codesToLoad.add(top.code);
      }
    }
    const tnvedByCode = await this.loadTnvedRates([...codesToLoad]);

    // Phase 4: Assemble results
    return {
      products: this.assembleResults(products, candidatesByProduct, selections, tnvedByCode, language),
      tokenUsage,
    };
  }

  // --- Phase 1: TKS Search ---

  private async searchAll(products: ProductRow[]): Promise<TksCandidate[][]> {
    const results: TksCandidate[][] = new Array(products.length);

    for (let i = 0; i < products.length; i += SEARCH_CONCURRENCY) {
      const batch = products.slice(i, i + SEARCH_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((product) =>
          this.searchOne(product.description).catch((err) => {
            this.logger.warn(
              `TKS search failed for "${product.description}": ${err instanceof Error ? err.message : err}`,
            );
            return [] as TksCandidate[];
          }),
        ),
      );
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  private async searchOne(description: string): Promise<TksCandidate[]> {
    const result = await this.tksApi.searchGoodsGrouped(description);
    if (!result.data.length) return [];

    return result.data
      .map((item) => ({
        code: item.CODE,
        name: item.KR_NAIM,
        confidence: calcProbability(item, result.hm),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES);
  }

  // --- Phase 2: Claude Classify+Verify ---

  private async classifyWithClaude(
    products: ProductRow[],
    candidatesByProduct: TksCandidate[][],
    language?: string,
  ): Promise<{ selections: (ClaudeSelection | null)[]; tokenUsage: TokenUsageMap }> {
    const allSelections: (ClaudeSelection | null)[] = new Array(products.length).fill(null);
    let totalUsage = emptyTokenUsageMap();

    for (let i = 0; i < products.length; i += CLAUDE_BATCH_SIZE) {
      const batchEnd = Math.min(i + CLAUDE_BATCH_SIZE, products.length);
      const items = [];
      for (let j = i; j < batchEnd; j++) {
        items.push({
          index: j,
          description: products[j].description,
          candidates: candidatesByProduct[j] ?? [],
        });
      }

      try {
        const { selections, tokenUsage } = await this.callClaude(items, language);
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const sel of selections) {
          if (sel.index >= 0 && sel.index < products.length) {
            allSelections[sel.index] = sel;
          }
        }
      } catch (err) {
        this.logger.error(`Claude classify+verify batch failed`, err);
        // Fallback: null selections → will use best TKS candidate
      }
    }

    return { selections: allSelections, tokenUsage: totalUsage };
  }

  private async callClaude(
    items: Array<{ index: number; description: string; candidates: TksCandidate[] }>,
    language?: string,
  ): Promise<{ selections: ClaudeSelection[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getClassifierModel();
    const needsLocalized = language && language !== 'ru';
    const commentInstruction = needsLocalized
      ? `    "comment": "краткое пояснение на русском",
    "comment_localized": "brief explanation in ${language === 'zh' ? 'Chinese' : 'English'}",`
      : `    "comment": "краткое пояснение",`;

    const userPrompt = `Классифицируй товары по ТН ВЭД:

${JSON.stringify(items, null, 2)}

Для каждого товара ответь JSON-массивом:
[
  {
    "index": 0,
    "tnVedCode": "1234567890",
    "confidence": 0.85,
${commentInstruction}
    "fromCandidates": true
  }
]

Отвечай ТОЛЬКО JSON-массивом.`;

    const response = await this.anthropic!.messages.create(
      { model, max_tokens: 2048, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] },
      { timeout: 30_000 },
    );

    const text = extractClaudeText(response);
    const parsed = parseClaudeJson(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array, got: ${typeof parsed}`);
    }
    return {
      selections: parsed as ClaudeSelection[],
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
          } catch {
            this.logger.warn(`Failed to load TNVED for ${code}`);
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
    language?: string,
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
      } else if (confidence < LOW_CONFIDENCE_THRESHOLD) {
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

      const suggestedCode =
        sel && !sel.fromCandidates ? sel.tnVedCode : null;

      return {
        ...product,
        tnVedCode: tnved.CODE,
        tnVedDescription: tnved.KR_NAIM,
        dutyRate: rates.IMP ?? 0,
        dutySign: rates.IMPSIGN ?? null,
        dutyMin: rates.IMP2 ?? null,
        dutyMinUnit: rates.IMPEDI2 ?? null,
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
    const reason = candidates.length === 0
      ? 'TKS не вернул кандидатов, AI не смог предложить код'
      : sel
        ? `AI предложил код ${sel.tnVedCode}, но он не найден в справочнике`
        : 'Не удалось определить код ТН ВЭД';

    return {
      ...product,
      tnVedCode: '',
      tnVedDescription: 'Не найден',
      dutyRate: 0,
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
