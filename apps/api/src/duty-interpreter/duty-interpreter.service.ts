import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, TnvedCode } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { extractToolInput, systemPrompt } from '../common/claude';
import { errMsg } from '../common/errors';
import { isFlatCurrencyUnit } from '../common/normalize-impedi';
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
- Объект conditions (TNVEDALL) с условиями применения, сгруппированными по PRIZNAK (1 = ввозная пошлина, 2 = акциз, 3 = НДС, 16 = временная, 19 = антидемпинговая, 20 = компенсационная)
- Краткое наименование товара (KR_NAIM)

ВАЖНО: Тип ставки IMP/IMP2/AKC определяется по соседнему полю-единице (IMPEDI/IMPEDI2/AKCEDI):
- IMPEDI = "1" или "%" (или пустое) → IMP это адвалорная ставка, значение IMP в процентах (IMP=10 → 10%)
- IMPEDI = ОКЕИ-код единицы ("166"=кг, "715"=пар, "055"=м², "112"=л, "113"=м³, "796"=шт, "798"=1000шт и т. д.) → IMP это специфическая ставка EUR за единицу (IMP=0.34 + IMPEDI="715" → 0.34 EUR/пар)
- Полное соответствие кодов см. tnvlook.json (tkssoft/api.tks.ru-docs); суффиксы D=USD, Р=RUB, A=AMD, B=BYR, C=KGS, K=KZT

Правила интерпретации:
1. IMP + IMPEDI — первая составляющая ввозной пошлины (адвалорная или специфическая по IMPEDI)
2. IMP2 + IMPEDI2 — вторая составляющая (обычно специфическая часть комбинированной ставки)
3. IMP3 + IMPEDI3 — редкая третья составляющая. Если присутствует — добавь как отдельный charge того же типа 'import_duty'
4. IMPSIGN: '>' = "но не менее", '<' = "но не более". Интерпретация зависит от типов IMP и IMP2:
   - IMP адвалорная + IMP2 специфическая → kind='combined_min' (для '>') или 'combined_max' (для '<'); в поле 'rate' адвалорная часть, в 'specificAmount' специфическая
   - IMP специфическая + IMP2 специфическая (обе с IMPEDI-единицей, возможно в разных единицах/валютах) → kind='combined_specific_min' (для '>') или 'combined_specific_max' (для '<'); primary = {amount:IMP, unit, per из IMPEDI}, fallback = {amount:IMP2, unit, per из IMPEDI2}
   - Если IMPSIGN пустой и есть только IMP — это просто чистая IMP-ставка
5. Никогда не домысливай: значение IMP берётся как есть. IMP=0.34 означает 0.34 (а не 34). Если IMPEDI указывает "%" — это 0.34%; если IMPEDI — единица — это 0.34 EUR/единицу
6. Валюта specific-ставки определяется по суффиксу IMPEDI: D=USD, Р=RUB, A=AMD, B=BYR, C=KGS, K=KZT, E=EUR (по умолчанию EUR). В поле 'unit' указывай код валюты (USD, RUB, EUR и т. д.), НЕ символ.
7. AKC + AKCEDI — акциз. Та же логика: AKCEDI указывает единицу (адвалорный % при AKCEDI="1"/"2"/"%"; специфический при AKCEDI — единица). Для кода 831 ("л 100% спирта", встречается в AKCEDI) в поле 'per' используй 'ethanol_l'
8. NDS — НДС в процентах напрямую (NDS=22 → 22%, NDS=20 → 20%, NDS=10 → 10%). Бери значение NDS как есть. С 2026-01-01 (ФЗ N 425-ФЗ от 28.11.2025) стандартная ставка НДС в РФ = 22%. Поля NDSEDI/NDS_PR — справочные коды (льготы, признаки), ставку из них НЕ пересчитывай
9. IMPTMP — временная пошлина, IMPDEMP — антидемпинговая, IMPCOMP — компенсационная. Та же логика IMP*/IMPEDI*. Добавляй как отдельные charges если ненулевые
10. База: ввозная пошлина/акциз от customs_value; НДС от customs_value_plus_duty_plus_excise
11. В поле "per" указывай каноническую единицу специфической ставки: kg, g, t, pair, pcs, m2, m3, l, km3, kl, cm3, kw, hp, ct, ethanol_l, gross_mass_t, load_capacity_t, capacity_m3.

`;

const INTERPRET_TOOL: Anthropic.Messages.Tool = {
  name: 'interpret_duties',
  description: 'Формализованные правила расчёта таможенных пошлин',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tnvedCode: { type: 'string' },
            charges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['import_duty', 'excise', 'vat', 'antidumping', 'compensatory', 'temp_duty'],
                  },
                  label: { type: 'string' },
                  method: {
                    type: 'object',
                    description:
                      'Требуемые поля зависят от kind: ad_valorem/fixed_rate — {rate}; ' +
                      'specific — {amount, unit, per}; combined_min/combined_max — {rate, specificAmount, unit, per}; ' +
                      'combined_specific_min/combined_specific_max — {primary:{amount,unit,per}, fallback:{amount,unit,per}}.',
                    properties: {
                      kind: {
                        type: 'string',
                        enum: [
                          'ad_valorem',
                          'specific',
                          'combined_min',
                          'combined_max',
                          'combined_specific_min',
                          'combined_specific_max',
                          'fixed_rate',
                        ],
                      },
                      rate: { type: 'number', description: 'Ставка в процентах (для ad_valorem, combined_min/max, fixed_rate)' },
                      amount: { type: 'number', description: 'Сумма (для specific)' },
                      specificAmount: { type: 'number', description: 'Специфическая сумма (для combined_min/max)' },
                      unit: { type: 'string', description: 'Код валюты: EUR, USD, RUB, BYN, AMD, KGS, KZT' },
                      per: { type: 'string', description: 'Каноническая единица: kg, g, t, ct, pair, pcs, kpcs, m, m2, m3, km3, l, kl, cm3, kw, hp, ethanol_l, gross_mass_t, load_capacity_t, capacity_m3' },
                      primary: {
                        type: 'object',
                        description: 'Первая specific-составляющая (для combined_specific_min/max)',
                        properties: {
                          amount: { type: 'number' },
                          unit: { type: 'string' },
                          per: { type: 'string' },
                        },
                        required: ['amount', 'unit', 'per'],
                      },
                      fallback: {
                        type: 'object',
                        description: 'Вторая specific-составляющая (для combined_specific_min/max)',
                        properties: {
                          amount: { type: 'number' },
                          unit: { type: 'string' },
                          per: { type: 'string' },
                        },
                        required: ['amount', 'unit', 'per'],
                      },
                    },
                    required: ['kind'],
                  },
                  base: {
                    type: 'string',
                    enum: ['customs_value', 'customs_value_plus_duty', 'customs_value_plus_duty_plus_excise'],
                  },
                },
                required: ['type', 'label', 'method', 'base'],
              },
            },
            requiredDimensions: { type: 'array', items: { type: 'string' } },
            reasoning: { type: 'string', description: 'Пояснение логики на русском' },
            reasoningLocalized: { type: 'string', description: 'Пояснение на языке пользователя' },
          },
          required: ['tnvedCode', 'charges', 'reasoning'],
        },
      },
    },
    required: ['items'],
  },
};

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
    this.logger.log(`Interpreting duties for ${products.length} products`);
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
        } catch (err) {
          this.logger.warn(`Failed to fetch TNVED data for ${code}: ${errMsg(err)}`);
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

    const useCache = codeBatches.length > 1;

    if (codeBatches.length > 0) {
      try {
        const { results, tokenUsage } = await this.interpretBatch(codeBatches[0], language, useCache);
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
          this.interpretBatch(batchData, language, useCache).catch((err) => {
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

    this.logger.log(`Interpretation done: ${interpretations.size} codes interpreted, ${codesToInterpret.length - validCodes.length} codes skipped (no TNVED data)`);

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
    // Чисто-валютная IMPEDI (500 EUR, 643 RUB) — фиксированная сумма, fallback
    // не знает, как её применять, поэтому всегда дергаем AI-интерпретатор.
    const flatCurrency = isFlatCurrencyUnit(p.dutyRateUnit);
    if (!rates) {
      return (
        (p.dutyMin != null && p.dutyMin > 0) ||
        !!p.dutySign ||
        (p.exciseRate != null && p.exciseRate > 0) ||
        flatCurrency
      );
    }
    return (
      (rates.IMP2 != null && rates.IMP2 > 0) ||
      !!rates.IMPSIGN ||
      (rates.AKC != null && rates.AKC > 0) ||
      (rates.IMPTMP != null && rates.IMPTMP > 0) ||
      (rates.IMPDEMP != null && rates.IMPDEMP > 0) ||
      (rates.IMPCOMP != null && rates.IMPCOMP > 0) ||
      flatCurrency
    );
  }

  private async interpretBatch(
    items: Array<{ code: string; tnved: TnvedCode }>,
    language?: string,
    useCache = false,
  ): Promise<{ results: DutyInterpretation[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getInterpreterModel();
    const codesData = items.map((item) => ({
      code: item.code,
      kr_naim: item.tnved.KR_NAIM,
      rates: item.tnved.TNVED ?? {},
      conditions: item.tnved.TNVEDALL ?? {},
    }));

    const localizedInstruction = language && language !== 'ru'
      ? `\nДополнительно: для каждого кода добавь reasoningLocalized — пояснение на ${language === 'zh' ? 'китайском' : 'английском'} языке.`
      : '';

    const userPrompt = `Интерпретируй ставки пошлин для следующих кодов ТН ВЭД:

<codes>
${JSON.stringify(codesData, null, 2)}
</codes>${localizedInstruction}`;

    const system = systemPrompt(SYSTEM_PROMPT, useCache);
    const response = await this.anthropic!.messages.create(
      {
        model,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [INTERPRET_TOOL],
        tool_choice: { type: 'any' },
      },
      { timeout: 30_000 },
    );

    const result = extractToolInput<{ items: DutyInterpretation[] }>(response);
    return {
      results: result.items,
      tokenUsage: tokenUsageFromResponse(model, response.usage),
    };
  }
}
