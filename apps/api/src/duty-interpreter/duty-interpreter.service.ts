import Anthropic from '@anthropic-ai/sdk';
import { Priznak, TksApiClient, TnvedCode, TnvedallEntry } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { cacheTools, extractToolInput, systemPrompt } from '../common/claude';
import { errMsg } from '../common/errors';
import { isFlatCurrencyUnit } from '../common/normalize-impedi';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, tokenUsageFromResponse } from '../common/token-usage';
import type { VerifiedProduct } from '../classifier/classifier.service';
import { PipelineAuditService, type AuditContext } from '../pipeline-audit/pipeline-audit.service';
import { DutyInterpretation, InterpretedProduct } from './interfaces';

const BATCH_SIZE = 5;
const CONCURRENCY = 2;
const CACHE_TTL = 3600_000; // 1 hour
/** Коды с conditions тяжелее этого (символов JSON) отправляются в Claude поодиночке. */
const HEAVY_CONDITIONS_THRESHOLD = 6000;
/** Суммарный размер conditions батча; при превышении — батч закрывается. */
const BATCH_PAYLOAD_LIMIT = 12000;

/**
 * PRIZNAK, влияющие на расчёт пошлин: ввозная, акциз, НДС, временная, антидемпинговая,
 * компенсационная, страновая льгота. Остальные (лицензии, сертификация, санкции,
 * маркировка, уведомления) к расчёту отношения не имеют — их отсекаем, чтобы ответ
 * Claude не обрезался по max_tokens на крупных TNVEDALL (коды типа 8708705009).
 */
const RELEVANT_PRIZNAKS: ReadonlySet<string> = new Set(
  [
    Priznak.ImportDuty,
    Priznak.Excise,
    Priznak.Vat,
    Priznak.TempSpecialDuty,
    Priznak.AntidumpingDuty,
    Priznak.CompensatoryDuty,
    Priznak.CountryImportDuty,
  ].map(String),
);

/** Ключи TNVEDALL, где сидят страновые условные ставки (антидемпинг/компенсационная/льгота). */
const COUNTRY_CONDITION_PRIZNAKS: readonly string[] = [
  String(Priznak.AntidumpingDuty),
  String(Priznak.CompensatoryDuty),
  String(Priznak.CountryImportDuty),
];

/** Ключ TNVEDALL с акцизными ставками (PRIZNAK=2). Там встречаются новые акцизы,
 *  которых ещё нет в плоском TNVED.AKC — fallback должен об этом предупреждать. */
const EXCISE_PRIZNAK = String(Priznak.Excise);

function filterRelevantConditions(
  conditions: Record<string, TnvedallEntry[]> | undefined,
): Record<string, TnvedallEntry[]> {
  if (!conditions) return {};
  const result: Record<string, TnvedallEntry[]> = {};
  for (const [key, entries] of Object.entries(conditions)) {
    if (RELEVANT_PRIZNAKS.has(key) && entries && entries.length > 0) {
      result[key] = entries;
    }
  }
  return result;
}

interface BatchItem {
  code: string;
  tnved: TnvedCode;
  /** Отфильтрованные по RELEVANT_PRIZNAKS conditions — используются и для оценки
   *  размера при упаковке батчей, и для payload в interpretBatch. */
  conditions: Record<string, TnvedallEntry[]>;
}

const SYSTEM_PROMPT = `Ты — эксперт по таможенному регулированию ЕАЭС. Твоя задача — интерпретировать ставки пошлин, акцизов и НДС из справочника ТН ВЭД и выразить их как формализованные правила расчёта.

Для каждого кода ТН ВЭД ты получаешь:
- Полный объект ставок (TNVED) со всеми полями (IMP, IMP2, IMP3, IMPSIGN, IMPEDI, IMPEDI2, AKC, NDS, IMPTMP, IMPDEMP, IMPCOMP и др.)
- Объект conditions (TNVEDALL) с условиями применения, сгруппированными по PRIZNAK (1 = ввозная пошлина, 2 = акциз, 3 = НДС, 16 = временная, 19 = антидемпинговая, 20 = компенсационная, 30 = преференция/льгота по стране)
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
7a. Если TNVED.AKC пуст/нулевой, дополнительно проверь conditions['2'] (TNVEDALL, PRIZNAK=2) — там лежат актуальные/новые акцизы, которые могли ещё не попасть в плоское поле AKC. Для КАЖДОЙ действующей записи (DBEGIN уже наступил или близко; DEND в будущем или null) создай отдельный charge type='excise'. Формат единицы из TYPEMIN: префикс = OKEI-код (112=л, 166=кг, 168=т, 796=шт, 798=тыс.шт, 055=м²), суффикс = код валюты (Р=RUB, Е или без суффикса=EUR, D=USD). Значение ставки бери из поля MIN (MAX у специфического акциза обычно null или 0). База — customs_value. Пример: TYPEMIN='112Р', MIN=11 → method={kind:'specific', amount:11, unit:'RUB', per:'l'}. В reasoning упомяни, что ставка взята из TNVEDALL[2] со ссылкой на DOC_N/DOC_D и период DBEGIN–DEND
8. NDS — НДС в процентах напрямую (NDS=22 → 22%, NDS=20 → 20%, NDS=10 → 10%). Бери значение NDS как есть. С 2026-01-01 (ФЗ N 425-ФЗ от 28.11.2025) стандартная ставка НДС в РФ = 22%. Поля NDSEDI/NDS_PR — справочные коды (льготы, признаки), ставку из них НЕ пересчитывай
9. IMPTMP — временная пошлина, IMPDEMP — антидемпинговая, IMPCOMP — компенсационная. Та же логика IMP*/IMPEDI*. Добавляй как отдельные charges если ненулевые
10. База: ввозная пошлина/акциз от customs_value; НДС от customs_value_plus_duty_plus_excise
11. В поле "per" указывай каноническую единицу специфической ставки: kg, g, t, pair, pcs, m2, m3, l, km3, kl, cm3, kw, hp, ct, ethanol_l, gross_mass_t, load_capacity_t, capacity_m3.

КРИТИЧЕСКИ ВАЖНО — ставки, зависящие от страны происхождения (PRIZNAK=19, 20, 30):
- Каждая строка TNVEDALL с PRIZNAK=19 — это ОТДЕЛЬНАЯ антидемпинговая ставка для КОНКРЕТНОЙ страны (см. поле CU — OKSMT-код страны). Они НЕ суммируются: к одной партии товара применяется максимум одна, по стране происхождения.
- То же для PRIZNAK=20 (компенсационная) и PRIZNAK=30 (преференциальная/льготная по стране).
- Для каждой такой строки создай ОТДЕЛЬНЫЙ charge:
  - type: 'antidumping' для PRIZNAK=19, 'compensatory' для PRIZNAK=20, 'import_duty' для PRIZNAK=30 (льготная ставка заменяет базовую ввозную)
  - method: {kind:'ad_valorem', rate: MIN} (ставка берётся из поля MIN, почти всегда адвалорная в процентах)
  - appliesWhen.country: строковое значение CU (OKSMT-код, 3 цифры, например "156"). ОБЯЗАТЕЛЬНО заполни.
  - appliesWhen.conditions: КРАТКОЕ резюме условий из NOTE этой конкретной строки (1-2 фразы, русский). Обязательно укажи ссылку на решение (DOC_N, DOC_D). Пример: "Только литые диски 13-20″, нагрузка ≤1150 кг, ЦО ≤131 мм. Решение ЕЭК N 7 от 14.01.2025".
- НЕ объединяй условия разных строк в один conditions. НЕ смешивай решения/даты из соседних строк.
- НЕ пытайся определить, подходит ли товар под условия (размеры, производитель). Calculator применит ставку по стране, условия выведет оператору как warning.

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
                  appliesWhen: {
                    type: 'object',
                    description:
                      'Условия применения. Обязательно для antidumping/compensatory ' +
                      'и для льготных ставок по стране (PRIZNAK=30).',
                    properties: {
                      country: {
                        type: 'string',
                        description: 'OKSMT-код страны происхождения (3 цифры, например "156"). Из поля CU соответствующей строки TNVEDALL.',
                      },
                      conditions: {
                        type: 'string',
                        description: 'Краткое резюме условий из NOTE (русский, 1-2 фразы, с DOC_N/DOC_D).',
                      },
                    },
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
    private audit: PipelineAuditService,
  ) {}

  async interpret(
    products: VerifiedProduct[],
    language?: string,
    auditContext: AuditContext | null = null,
  ): Promise<{ products: InterpretedProduct[]; tokenUsage: TokenUsageMap; usedFallback: boolean }> {
    this.logger.log(`Interpreting duties for ${products.length} products`);
    if (!this.anthropic) {
      const usedFallback = products.some((p) => this.hasNonTrivialRates(p));
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
      }), tokenUsage: emptyTokenUsageMap(), usedFallback };
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
    // Адаптивная упаковка: тяжёлые коды идут поодиночке, лёгкие группируются
    // до BATCH_SIZE и до общего лимита payload. Это защищает ответ Claude
    // от обрезки по max_tokens на раздутых TNVEDALL. Отфильтрованные conditions
    // кэшируются в BatchItem, чтобы interpretBatch не пересчитывал их повторно.
    const codeBatches: BatchItem[][] = [];
    {
      let current: BatchItem[] = [];
      let currentSize = 0;
      const flush = () => {
        if (current.length > 0) {
          codeBatches.push(current);
          current = [];
          currentSize = 0;
        }
      };
      for (const code of validCodes) {
        const tnved = tnvedData.get(code)!;
        const conditions = filterRelevantConditions(tnved.TNVEDALL);
        const size = JSON.stringify(conditions).length;
        const item: BatchItem = { code, tnved, conditions };
        if (size >= HEAVY_CONDITIONS_THRESHOLD) {
          flush();
          codeBatches.push([item]);
          continue;
        }
        if (
          current.length >= BATCH_SIZE ||
          (current.length > 0 && currentSize + size > BATCH_PAYLOAD_LIMIT)
        ) {
          flush();
        }
        current.push(item);
        currentSize += size;
      }
      flush();
    }

    const useCache = codeBatches.length > 1;

    if (codeBatches.length > 0) {
      try {
        const { results, tokenUsage } = await this.interpretBatch(
          codeBatches[0],
          language,
          useCache,
          auditContext,
        );
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
          this.interpretBatch(batchData, language, useCache, auditContext).catch((err) => {
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

    const resultProducts = products.map((p) => {
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
    });

    const usedFallback =
      codesToInterpret.length > validCodes.length ||
      resultProducts.some(
        (p) => !p.dutyInterpretation && p.tnVedCode && this.hasNonTrivialRates(p),
      );

    return { tokenUsage: totalUsage, products: resultProducts, usedFallback };
  }

  /**
   * Есть ли у товара нетривиальные ставки, для корректной обработки которых нужен AI?
   * Триггеры:
   *   - IMP2/IMPSIGN — комбинированная ставка;
   *   - AKC/IMPTMP/IMPDEMP/IMPCOMP — акциз или отдельные пошлины;
   *   - flat-currency IMPEDI — фиксированная сумма (500 EUR, 643 RUB);
   *   - TNVEDALL[19/20/30] — страновые условные ставки, они в плоских rates не лежат,
   *     но без AI fallback их не увидит; без warning оператор просто не узнает,
   *     что расчёт неполный (как было с 8708705009 на stage).
   */
  private hasNonTrivialRates(p: VerifiedProduct): boolean {
    const rates = p.tnvedRaw?.TNVED;
    const conditions = p.tnvedRaw?.TNVEDALL;
    const hasCountryConditions =
      conditions != null &&
      COUNTRY_CONDITION_PRIZNAKS.some((pk) => (conditions[pk]?.length ?? 0) > 0);
    const hasExciseConditions =
      conditions != null &&
      (conditions[EXCISE_PRIZNAK]?.some((e) => (e.MIN ?? 0) > 0) ?? false);
    const flatCurrency = isFlatCurrencyUnit(p.dutyRateUnit);
    if (!rates) {
      return (
        (p.dutyMin != null && p.dutyMin > 0) ||
        !!p.dutySign ||
        (p.exciseRate != null && p.exciseRate > 0) ||
        flatCurrency ||
        hasCountryConditions ||
        hasExciseConditions
      );
    }
    return (
      (rates.IMP2 != null && rates.IMP2 > 0) ||
      !!rates.IMPSIGN ||
      (rates.AKC != null && rates.AKC > 0) ||
      (rates.IMPTMP != null && rates.IMPTMP > 0) ||
      (rates.IMPDEMP != null && rates.IMPDEMP > 0) ||
      (rates.IMPCOMP != null && rates.IMPCOMP > 0) ||
      flatCurrency ||
      hasCountryConditions ||
      hasExciseConditions
    );
  }

  private async interpretBatch(
    items: BatchItem[],
    language?: string,
    useCache = false,
    auditContext: AuditContext | null = null,
  ): Promise<{ results: DutyInterpretation[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getInterpreterModel();
    const codesData = items.map((item) => ({
      code: item.code,
      kr_naim: item.tnved.KR_NAIM,
      rates: item.tnved.TNVED ?? {},
      conditions: item.conditions,
    }));

    const localizedInstruction = language && language !== 'ru'
      ? `\nДополнительно: для каждого кода добавь reasoningLocalized — пояснение на ${language === 'zh' ? 'китайском' : 'английском'} языке.`
      : '';

    const userPrompt = `Интерпретируй ставки пошлин для следующих кодов ТН ВЭД:

<codes>
${JSON.stringify(codesData, null, 2)}
</codes>${localizedInstruction}`;

    const response = await this.audit.trackAiCall(
      {
        context: auditContext,
        purpose: 'interpret',
        model,
        request: {
          model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
          tools: [INTERPRET_TOOL.name],
          tool_choice: 'any',
          codes: items.map((i) => i.code),
        },
      },
      () =>
        this.anthropic!.messages.create(
          {
            model,
            max_tokens: 8192,
            system: systemPrompt(SYSTEM_PROMPT),
            messages: [{ role: 'user', content: userPrompt }],
            tools: cacheTools([INTERPRET_TOOL], useCache),
            tool_choice: { type: 'any' },
          },
          { timeout: 90_000 },
        ),
    );

    const result = extractToolInput<{ items: DutyInterpretation[] }>(response);
    return {
      results: result.items,
      tokenUsage: tokenUsageFromResponse(model, response.usage),
    };
  }
}
