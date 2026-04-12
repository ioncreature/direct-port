import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, TnvedCode } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { cachedSystemPrompt, extractClaudeText, parseClaudeJson } from '../common/claude';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, tokenUsageFromResponse } from '../common/token-usage';
import type { VerifiedProduct } from '../classifier/classifier.service';
import { DutyInterpretation, InterpretedProduct } from './interfaces';

const BATCH_SIZE = 5;
const CONCURRENCY = 2;
const CACHE_TTL = 3600_000; // 1 hour

const SYSTEM_PROMPT = `Ты — эксперт по таможенному регулированию ЕАЭС. Твоя задача — интерпретировать ставки пошлин, акцизов и НДС из справочника ТН ВЭД и выразить их как формализованные правила расчёта.

Для каждого кода ТН ВЭД ты получаешь:
- Полный объект ставок (TNVED) со всеми полями (IMP, IMP2, IMP3, IMPSIGN, IMPEDI, IMPEDI2, AKC, NDS, IMPTMP, IMPDEMP, IMPCOMP и др.)
- Массив Tnvedall с условиями применения (PRIZNAK, MIN/MAX, единицы измерения)
- Краткое наименование товара (KR_NAIM)

Правила интерпретации:
1. IMP — адвалорная ставка ввозной пошлины (% от таможенной стоимости)
2. IMP2 + IMPEDI2 — специфическая составляющая (фиксированная сумма за единицу: EUR/кг, EUR/л, EUR/м2, EUR/шт)
3. IMPSIGN: '>' = "но не менее" (max из адвалорной и специфической), '<' = "но не более" (min)
4. AKC — акциз. Может быть адвалорный (%) или специфический. AKCEDI указывает единицу
5. NDS — НДС. Обычно 20%, иногда 10% для продуктов, лекарств, детских товаров
6. IMPTMP — временная пошлина, IMPDEMP — антидемпинговая, IMPCOMP — компенсационная. Добавляй как отдельные начисления если ненулевые
7. База: пошлина от customs_value, акциз от customs_value, НДС от customs_value_plus_duty_plus_excise
8. В поле "per" указывай единицу для специфических ставок: kg, m2, l, pcs, m3 и т.д.

Выдавай ТОЛЬКО валидный JSON-массив. Без markdown-обёртки.`;

@Injectable()
export class DutyInterpreterService {
  private logger = new Logger(DutyInterpreterService.name);
  private cache = new Map<string, { data: DutyInterpretation; expiresAt: number }>();

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private tksApi: TksApiClient,
    private aiConfig: AiConfigService,
  ) {}

  async interpret(
    products: VerifiedProduct[],
    language?: string,
  ): Promise<{ products: InterpretedProduct[]; tokenUsage: TokenUsageMap }> {
    if (!this.anthropic) {
      return { products: products.map((p) => {
        const extraNotes: ProductNote[] = [];
        if (this.hasNonTrivialRates(p)) {
          extraNotes.push({
            stage: 'interpret',
            severity: 'warning',
            field: 'duty',
            message:
              'У кода ТН ВЭД есть нетривиальные ставки (специфическая или комбинированная часть), но AI-интерпретатор отключён (нет ANTHROPIC_API_KEY). Расчёт будет выполнен по упрощённым правилам TKS.',
            messageLocalized: getStaticNoteTranslation('interpreter-disabled', language),
          });
        }
        return { ...p, dutyInterpretation: null, notes: [...p.notes, ...extraNotes] };
      }), tokenUsage: emptyTokenUsageMap() };
    }

    // Group by unique TNVED code
    const codeToIndices = new Map<string, number[]>();
    for (let i = 0; i < products.length; i++) {
      const code = products[i].tnVedCode;
      if (!code) continue;
      const indices = codeToIndices.get(code) ?? [];
      indices.push(i);
      codeToIndices.set(code, indices);
    }

    // Check cache, collect codes that need interpretation
    const interpretations = new Map<string, DutyInterpretation>();
    const codesToInterpret: string[] = [];

    for (const code of codeToIndices.keys()) {
      const cached = this.cache.get(code);
      if (cached && cached.expiresAt > Date.now()) {
        interpretations.set(code, cached.data);
      } else {
        codesToInterpret.push(code);
      }
    }

    // Fetch full TNVED data for uncached codes
    const tnvedData = new Map<string, TnvedCode>();
    await Promise.all(
      codesToInterpret.map(async (code) => {
        try {
          const raw = products.find((p) => p.tnVedCode === code)?.tnvedRaw;
          if (raw) {
            tnvedData.set(code, raw);
          } else {
            tnvedData.set(code, await this.tksApi.getTnvedCode(code));
          }
        } catch {
          this.logger.warn(`Failed to fetch TNVED data for ${code}`);
        }
      }),
    );

    // Batch interpret via Claude
    let totalUsage = emptyTokenUsageMap();
    const validCodes = codesToInterpret.filter((c) => tnvedData.has(c));
    // Pre-build batches
    const codeBatches: Array<{ code: string; tnved: TnvedCode }>[] = [];
    for (let i = 0; i < validCodes.length; i += BATCH_SIZE) {
      codeBatches.push(
        validCodes.slice(i, i + BATCH_SIZE).map((code) => ({
          code,
          tnved: tnvedData.get(code)!,
        })),
      );
    }

    // First batch alone — warms the prompt cache
    if (codeBatches.length > 0) {
      try {
        const { results, tokenUsage } = await this.interpretBatch(codeBatches[0], language);
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const result of results) {
          interpretations.set(result.tnvedCode, result);
          this.cache.set(result.tnvedCode, { data: result, expiresAt: Date.now() + CACHE_TTL });
        }
      } catch (err) {
        this.logger.error('Duty interpretation batch failed', err);
      }
    }

    // Remaining batches in parallel — prompt cache is warm
    const remainingBatches = codeBatches.slice(1);
    for (let g = 0; g < remainingBatches.length; g += CONCURRENCY) {
      const group = remainingBatches.slice(g, g + CONCURRENCY);
      const results = await Promise.all(
        group.map((batchData) =>
          this.interpretBatch(batchData, language).catch((err) => {
            this.logger.error('Duty interpretation batch failed', err);
            return { results: [] as DutyInterpretation[], tokenUsage: emptyTokenUsageMap() };
          }),
        ),
      );
      for (const { results: batchResults, tokenUsage } of results) {
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const result of batchResults) {
          interpretations.set(result.tnvedCode, result);
          this.cache.set(result.tnvedCode, { data: result, expiresAt: Date.now() + CACHE_TTL });
        }
      }
    }

    // Apply interpretations to products
    return { tokenUsage: totalUsage, products: products.map((p) => {
      const interpretation = interpretations.get(p.tnVedCode) ?? null;
      const extraNotes: ProductNote[] = [];

      if (interpretation?.reasoning) {
        extraNotes.push({
          stage: 'interpret',
          severity: 'info',
          field: 'duty',
          message: `Интерпретация ставок: ${interpretation.reasoning}`,
          messageLocalized: interpretation.reasoningLocalized
            ? `Duty rate interpretation: ${interpretation.reasoningLocalized}`
            : undefined,
        });
      }

      if (!interpretation && p.tnVedCode && this.hasNonTrivialRates(p)) {
        extraNotes.push({
          stage: 'interpret',
          severity: 'warning',
          field: 'duty',
          message:
            'AI-интерпретация ставок не получена (Claude вернул пустой ответ или была ошибка). Расчёт использует упрощённые правила TKS.',
          messageLocalized: getStaticNoteTranslation('interpreter-failed', language),
        });
      }

      return {
        ...p,
        dutyInterpretation: interpretation,
        notes: [...p.notes, ...extraNotes],
      };
    }) };
  }

  /**
   * Есть ли у товара нетривиальные ставки, для корректной обработки которых нужен AI?
   * Триггеры: специфическая часть (IMP2), комбинированная ставка (IMPSIGN), акциз не 0,
   * антидемпинговая/компенсационная/временная пошлина.
   */
  private hasNonTrivialRates(p: VerifiedProduct): boolean {
    const rates = p.tnvedRaw?.TNVED;
    if (!rates) {
      // Работаем по denormalized полям
      return (
        (p.dutyMin != null && p.dutyMin > 0) ||
        !!p.dutySign ||
        (p.exciseRate != null && p.exciseRate > 0)
      );
    }
    return (
      (rates.IMP2 != null && rates.IMP2 > 0) ||
      !!rates.IMPSIGN ||
      (rates.AKC != null && rates.AKC > 0) ||
      (rates.IMPTMP != null && rates.IMPTMP > 0) ||
      (rates.IMPDEMP != null && rates.IMPDEMP > 0) ||
      (rates.IMPCOMP != null && rates.IMPCOMP > 0)
    );
  }

  private async interpretBatch(
    items: Array<{ code: string; tnved: TnvedCode }>,
    language?: string,
  ): Promise<{ results: DutyInterpretation[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getInterpreterModel();
    const codesData = items.map((item) => ({
      code: item.code,
      kr_naim: item.tnved.KR_NAIM,
      rates: item.tnved.TNVED ?? {},
      conditions: item.tnved.Tnvedall ?? [],
    }));

    const userPrompt = `Интерпретируй ставки пошлин для следующих кодов ТН ВЭД:

<codes>
${JSON.stringify(codesData, null, 2)}
</codes>

Для каждого кода верни объект:
{
  "tnvedCode": "1234567890",
  "charges": [
    {
      "type": "import_duty" | "excise" | "vat" | "antidumping" | "compensatory" | "temp_duty",
      "label": "Описание на русском",
      "method": { "kind": "ad_valorem", "rate": число }
             | { "kind": "specific", "amount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "combined_min", "rate": число, "specificAmount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "combined_max", "rate": число, "specificAmount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "fixed_rate", "rate": число },
      "base": "customs_value" | "customs_value_plus_duty" | "customs_value_plus_duty_plus_excise"
    }
  ],
  "requiredDimensions": ["area", "volume"],
  "reasoning": "Пояснение логики"${language && language !== 'ru' ? `,\n  "reasoningLocalized": "Explanation in ${language === 'zh' ? 'Chinese' : 'English'}"` : ''}
}

Отвечай ТОЛЬКО JSON-массивом.`;

    const response = await this.anthropic!.messages.create(
      { model, max_tokens: 2048, system: cachedSystemPrompt(SYSTEM_PROMPT), messages: [{ role: 'user', content: userPrompt }] },
      { timeout: 30_000 },
    );

    const text = extractClaudeText(response);

    const parsed = parseClaudeJson(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array from Claude');
    }

    return {
      results: parsed as DutyInterpretation[],
      tokenUsage: tokenUsageFromResponse(model, response.usage),
    };
  }
}
