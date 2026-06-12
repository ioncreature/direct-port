import Anthropic from '@anthropic-ai/sdk';
import { Priznak, TksApiClient, TnvedCode, TnvedallEntry } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiConfigService } from '../ai-config/ai-config.service';
import { DutyInterpretationCache } from '../database/entities/duty-interpretation-cache.entity';
import { extractToolInputArrayField } from '../common/claude';
import { callClaudeTool } from '../common/claude-tool-call';
import { errMsg } from '../common/errors';
import { localizedLanguageName } from '../common/i18n';
import { isFlatCurrencyUnit } from '../common/normalize-impedi';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, modelFamily } from '../common/token-usage';
import type { VerifiedProduct } from '../classifier/classifier.service';
import { PipelineAuditService, type AuditContext } from '../pipeline-audit/pipeline-audit.service';
import { ChargeMethod, DutyInterpretation, InterpretedProduct } from './interfaces';

const BATCH_SIZE = 5;
const CONCURRENCY = 2;
const CACHE_TTL = 3600_000; // 1 hour (in-memory)
const PERSISTENT_CACHE_TTL_MS = 180 * 24 * 3600_000; // 180 days (DB)
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
8a. ВАЖНО — НДС всегда ОДНА ставка. Создавай РОВНО ОДИН charge type='vat' со ставкой из плоского TNVED.NDS. НЕ создавай отдельные vat-charges для записей из conditions['3'] (TNVEDALL, PRIZNAK=3 — льготные ставки НДС 10%/0% для медизделий, детских товаров, книг, школьных принадлежностей, ТСР инвалидов и т. п.). Применимость льготы зависит от свойств конкретного товара (регистрационное удостоверение, возрастная категория, состав), которые не видны из таблицы — её должен определять оператор, не AI. Если в conditions['3'] есть льготные ставки — упомяни их в reasoning одной строкой ("у кода есть льгота НДС 10% для медизделий с РУ"), но НЕ кодируй как отдельный charge. Несколько vat-charges складываются в Calculator и завышают НДС в 2-3 раза
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

/** Адвалорная ставка выше этого (%) — явная галлюцинация/инъекция, не реальная ставка. */
const MAX_RATE_PERCENT = 1000;
/** Специфическая сумма за единицу (в валюте ставки) выше этого — заведомо битое число. */
const MAX_SPECIFIC_AMOUNT = 1e9;

/**
 * Зануляет нефинитные/отрицательные и клампит абсурдно большие числа. LLM-интерпретатор
 * может вернуть битое число (галлюцинация или инъекция через NOTE/conditions TKS), а
 * Calculator умножает его в денежную сумму без собственной проверки: отрицательная ставка
 * занизит пошлину и НДС, Infinity протечёт в итог. Это граница доверия к выходу модели.
 */
function clampToRange(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > max ? max : n;
}

function sanitizeChargeMethod(method: ChargeMethod): ChargeMethod {
  switch (method.kind) {
    case 'ad_valorem':
    case 'fixed_rate':
      return { ...method, rate: clampToRange(method.rate, MAX_RATE_PERCENT) };
    case 'specific':
      return { ...method, amount: clampToRange(method.amount, MAX_SPECIFIC_AMOUNT) };
    case 'combined_min':
    case 'combined_max':
      return {
        ...method,
        rate: clampToRange(method.rate, MAX_RATE_PERCENT),
        specificAmount: clampToRange(method.specificAmount, MAX_SPECIFIC_AMOUNT),
      };
    case 'combined_specific_min':
    case 'combined_specific_max':
      return {
        ...method,
        primary: { ...method.primary, amount: clampToRange(method.primary.amount, MAX_SPECIFIC_AMOUNT) },
        fallback: { ...method.fallback, amount: clampToRange(method.fallback.amount, MAX_SPECIFIC_AMOUNT) },
      };
    default:
      return method;
  }
}

/** Прогоняет числовые поля всех charges интерпретации через clampToRange. */
function sanitizeInterpretation(interp: DutyInterpretation): DutyInterpretation {
  if (!Array.isArray(interp.charges)) return interp;
  return {
    ...interp,
    charges: interp.charges.map((c) => ({ ...c, method: sanitizeChargeMethod(c.method) })),
  };
}

@Injectable()
export class DutyInterpreterService {
  private logger = new Logger(DutyInterpreterService.name);
  private cache = new Map<string, { data: DutyInterpretation; expiresAt: number }>();

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private tksApi: TksApiClient,
    private aiConfig: AiConfigService,
    private audit: PipelineAuditService,
    @Optional()
    @InjectRepository(DutyInterpretationCache)
    private persistentCache: Repository<DutyInterpretationCache> | null = null,
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

    // Только коды, у которых хотя бы один товар имеет нетривиальные ставки,
    // нуждаются в AI-интерпретации. Чисто адвалорные ставки (% без условий по
    // стране, без специфической части, без акциза) Calculator считает из плоских
    // полей TNVED напрямую — Claude тут не нужен.
    const codesNeedingInterpretation = new Set<string>();
    for (const [code, indices] of codeToIndices) {
      if (indices.some((i) => this.hasNonTrivialRates(products[i]))) {
        codesNeedingInterpretation.add(code);
      }
    }
    const skippedSimpleCodes = codeToIndices.size - codesNeedingInterpretation.size;

    // L1/L2 кэш ключуются по (code, language, model): reasoningLocalized зависит от
    // языка, а смена interpreter-модели меняет интерпретацию. L1 раньше ключевался
    // голым code и в пределах TTL мог отдать интерпретацию на чужом языке / от старой
    // модели — поэтому langKey и cacheModelKey считаем ДО L1-чтения.
    const langKey = language ?? 'ru';
    const interpreterModel = await this.aiConfig.getInterpreterModel();
    // model в кэше хранится как семейство (sonnet/opus/haiku) — см. миграцию
    // NormalizeModelFamilies. Конкретный version ID (например `claude-opus-4-8`) не
    // должен инвалидировать кэш при минорных апдейтах: интерпретация ставок ТН ВЭД
    // от точечной версии семейства практически не зависит.
    const cacheModelKey = modelFamily(interpreterModel);
    const l1Key = (code: string) => `${code}|${langKey}|${cacheModelKey}`;

    // Check L1 in-memory cache, collect codes that need further lookup
    const interpretations = new Map<string, DutyInterpretation>();
    let codesToInterpret: string[] = [];

    for (const code of codeToIndices.keys()) {
      if (!codesNeedingInterpretation.has(code)) continue;
      const cached = this.cache.get(l1Key(code));
      if (cached && cached.expiresAt > Date.now()) {
        interpretations.set(code, cached.data);
      } else {
        codesToInterpret.push(code);
      }
    }

    // L2 persistent (DB) cache — правила пошлин ТН ВЭД меняются редко, ответ Claude
    // хранится 180 дней (см. PERSISTENT_CACHE_TTL_MS).
    let dbHits = 0;
    if (codesToInterpret.length > 0 && this.persistentCache) {
      const fromDb = await this.loadFromPersistentCache(
        codesToInterpret,
        langKey,
        cacheModelKey,
      );
      for (const [code, rawData] of fromDb) {
        // Кламп — граница доверия перед Calculator: L2 хранит записи до 180 дней,
        // включая записанные до появления sanitize; для валидных данных это no-op.
        const data = sanitizeInterpretation(rawData);
        interpretations.set(code, data);
        this.cache.set(l1Key(code), { data, expiresAt: Date.now() + CACHE_TTL });
      }
      dbHits = fromDb.size;
      codesToInterpret = codesToInterpret.filter((c) => !fromDb.has(c));
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
    const freshFromClaude: DutyInterpretation[] = [];

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
          this.cache.set(l1Key(result.tnvedCode), { data: result, expiresAt: Date.now() + CACHE_TTL });
          freshFromClaude.push(result);
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
          this.cache.set(l1Key(result.tnvedCode), { data: result, expiresAt: Date.now() + CACHE_TTL });
          freshFromClaude.push(result);
        }
      }
    }

    if (freshFromClaude.length > 0 && this.persistentCache) {
      await this.savePersistentCache(freshFromClaude, langKey, cacheModelKey).catch((err) => {
        this.logger.warn(`Persistent cache save failed: ${errMsg(err)}`);
      });
    }

    this.logger.log(
      `Interpretation done: ${interpretations.size} codes interpreted ` +
        `(${dbHits} from DB cache, ${freshFromClaude.length} from Claude), ` +
        `${codesToInterpret.length - validCodes.length} skipped (no TNVED data), ` +
        `${skippedSimpleCodes} skipped (simple ad valorem rates)`,
    );

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

  private async loadFromPersistentCache(
    codes: string[],
    language: string,
    model: string,
  ): Promise<Map<string, DutyInterpretation>> {
    const result = new Map<string, DutyInterpretation>();
    if (!this.persistentCache || codes.length === 0) return result;
    try {
      const cutoff = new Date(Date.now() - PERSISTENT_CACHE_TTL_MS);
      const rows = await this.persistentCache.find({
        where: { tnvedCode: In(codes), language, model },
      });
      for (const row of rows) {
        if (row.fetchedAt >= cutoff) {
          result.set(row.tnvedCode, row.interpretation);
        }
      }
    } catch (err) {
      this.logger.warn(`Persistent cache lookup failed: ${errMsg(err)}`);
    }
    return result;
  }

  private async savePersistentCache(
    items: DutyInterpretation[],
    language: string,
    model: string,
  ): Promise<void> {
    if (!this.persistentCache || items.length === 0) return;
    const now = new Date();
    const rows = items.map((data) => ({
      tnvedCode: data.tnvedCode,
      language,
      model,
      interpretation: data,
      fetchedAt: now,
    }));
    await this.persistentCache
      .createQueryBuilder()
      .insert()
      .into(DutyInterpretationCache)
      .values(rows)
      .orUpdate(['interpretation', 'fetched_at'], ['tnved_code', 'language', 'model'])
      .execute();
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
      ? `\nДополнительно: для каждого кода добавь reasoningLocalized — пояснение на ${localizedLanguageName(language)} языке.`
      : '';

    const userPrompt = `Интерпретируй ставки пошлин для следующих кодов ТН ВЭД:

<codes>
${JSON.stringify(codesData, null, 2)}
</codes>${localizedInstruction}`;

    const { response, tokenUsage } = await callClaudeTool(
      this.anthropic!,
      this.audit,
      {
        model,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: userPrompt,
        tool: INTERPRET_TOOL,
        maxTokens: 8192,
        useCache,
      },
      {
        context: auditContext,
        purpose: 'interpret',
        extraRequest: { codes: items.map((i) => i.code) },
      },
    );

    const results = extractToolInputArrayField<DutyInterpretation>(response, 'items');
    if (!results) {
      this.logger.error(
        `Claude interpret response missing "items" array (batch=${items.length}, stop=${response.stop_reason})`,
      );
      return { results: [], tokenUsage };
    }
    return { results: results.map(sanitizeInterpretation), tokenUsage };
  }
}
