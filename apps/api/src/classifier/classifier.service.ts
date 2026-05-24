import Anthropic from '@anthropic-ai/sdk';
import {
  TksApiClient,
  calcProbability,
  type GoodsItem,
  type TnvedCode,
} from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import {
  CLAUDE_TIMEOUT_PIPELINE_MS,
  cacheTools,
  extractToolInput,
  extractToolInputArrayField,
  systemPrompt,
} from '../common/claude';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../common/confidence';
import { errMsg } from '../common/errors';
import { localizedLanguageName } from '../common/i18n';
import type { ProductNote } from '../common/product-notes';
import {
  emptyTokenUsageMap,
  mergeTokenUsage,
  tokenUsageFromResponse,
  type TokenUsageMap,
} from '../common/token-usage';
import type { AiCallPurpose } from '../database/entities/ai-call.entity';
import type { DocumentPhoto } from '../database/entities/document-photo.entity';
import type { Dimension } from '../duty-interpreter/interfaces';
import { PhotoStorageService } from '../photo-storage/photo-storage.service';
import { PipelineAuditService, type AuditContext } from '../pipeline-audit/pipeline-audit.service';
import {
  MISSING_DATA_CATEGORIES,
  assembleResults,
  buildRateFields,
  type MissingDataCategory,
} from './classification-assembler';

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
  /**
   * Топ-3 кодов, которые Claude рассматривал во время классификации (выбранный + до 2 альтернатив).
   * Заполняется только при низкой уверенности — оператор использует список как опору
   * при ручном выборе кода через `POST /documents/:id/rows/:index/set-code`.
   */
  candidateCodes?: CodeCandidate[];
  missingDataCategories?: MissingDataCategory[];
}

// re-export — определения переехали в ./classification-assembler, но внешние
// потребители (result-row.helper, classify_products tool schema) импортируют
// MissingDataCategory отсюда.
export { MISSING_DATA_CATEGORIES };
export type { MissingDataCategory };

/**
 * Один из вариантов кода ТН ВЭД, который Claude рассматривал в classify-стадии.
 * Включает уже подгруженные ставки из TKS, чтобы оператор сразу видел dutyRate/vatRate/exciseRate
 * без дополнительного запроса.
 */
export interface CodeCandidate {
  code: string;
  description: string;
  dutyRate: number;
  dutyRateUnit: string | null;
  vatRate: number;
  exciseRate: number;
  confidence: number;
  reasoning: string;
  reasoningLocalized?: string;
}

/**
 * Alias для обратной совместимости. Раньше Verification был отдельным шагом,
 * теперь classify+verify объединены в ClassifierService.
 */
export type VerifiedProduct = ClassifiedProduct;

export interface TksCandidate {
  code: string;
  name: string;
  confidence: number;
}

export interface ClaudeAlternative {
  tnVedCode: string;
  confidence: number;
  reasoning: string;
  reasoning_localized?: string;
}

export interface ClaudeSelection {
  index: number;
  tnVedCode: string;
  confidence: number;
  comment: string;
  comment_localized?: string;
  fromCandidates: boolean;
  /**
   * До 2 альтернативных кодов, которые Claude также рассматривал в classify-стадии.
   * Заполняется когда уверенность ниже `confidenceThreshold` (порог из CalculationConfig
   * передаётся в user-prompt) либо когда несколько кандидатов TKS близки по релевантности.
   */
  alternatives?: ClaudeAlternative[];
  missingDataCategories?: MissingDataCategory[];
}

/**
 * Диагностика, которую классификатор возвращает вместе с результатом —
 * используется аудитом pipeline, чтобы в stage_run.output лежали все
 * промежуточные данные: поисковые запросы, кандидаты TKS, решения Claude.
 */
export interface ClassifierAudit {
  searchQueries: string[][];
  tksCandidates: TksCandidate[][];
  selections: (ClaudeSelection | null)[];
}

interface ClassifyItem {
  index: number;
  description: string;
  candidates: TksCandidate[];
  rawContext?: string;
  hsCode?: string;
  hsCodeValid?: boolean;
  /** Заполняется только в retry-вызове: код, который выбрал Claude в первой попытке и которого не оказалось в TKS. */
  previousCode?: string;
}

const SEARCH_CONCURRENCY = 5;
const CLAUDE_BATCH_SIZE = 20;
const CLAUDE_CONCURRENCY = 2;
const VISION_CONCURRENCY = 3;
const MAX_CANDIDATES = 5;
const QUERIES_PER_PRODUCT = 5;
const CLASSIFICATION_CACHE_TTL = 86_400_000; // 24 hours

/**
 * Префикс user-prompt'а для retry-вызова classify, когда Claude в первой
 * попытке выбрал код вне справочника TKS. Экспортируется, чтобы тесты и
 * mock createService могли узнавать retry-вызов по единой строке (а не
 * по копиям 'Повторная классификация' в трёх местах).
 */
export const CLASSIFIER_RETRY_PROMPT_INTRO =
  'Повторная классификация. В предыдущей попытке ты предложил коды (поле previousCode), которых НЕТ в справочнике ТН ВЭД (TKS). ' +
  'Выбери tnVedCode СТРОГО из списка candidates (fromCandidates=true). ' +
  'Не предлагай коды вне candidates: справочник TKS их не содержит, что бы ты ни считал теоретически верным. ' +
  'Если ни один кандидат не подходит идеально — возьми ближайший по смыслу и понизь confidence. ' +
  'В comment объясни выбор и причину, почему previousCode не подошёл';
const CLASSIFICATION_CACHE_MAX = 1000;

const SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации товаров по ТН ВЭД (Товарная номенклатура внешнеэкономической деятельности ЕАЭС).

Для каждого товара тебе предоставлены описание, контекст (rawContext: материал, характеристики и т.д.) и кандидаты из справочника TKS с оценкой релевантности.

rawContext — это набор именованных пар "имя_колонки=значение", разделённых "; ". Имена колонок — заголовки исходного файла (могут быть на разных языках, например "品名 / наименование товара=...; 材质 / материал=塑料"). Если в rawContext встречается альтернативное наименование товара (часто на китайском или английском, в колонках типа 品名/name) — учитывай его наравне с основным описанием: оно может уточнить тип товара, особенно когда основное описание короткое или неточное.

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
- alternatives: верни до 2 альтернативных кодов, которые ты всерьёз рассматривал, если confidence ниже confidenceThreshold (поле передаётся вместе с описанием каждого товара) ИЛИ если несколько кандидатов TKS близки по релевантности. Это коды, между которыми ты колебался. Для каждой альтернативы укажи tnVedCode, свою уверенность в ней и одну короткую фразу: чем она отличается от выбранного и почему ты её не выбрал. При высокой уверенности (заметно выше порога) alternatives оставляй пустым.
- missingDataCategories: если confidence < confidenceThreshold, верни 1–3 кода категорий данных, которых тебе не хватило для уверенной классификации. Это критически важное поле — клиент видит твой ответ как точечный вопрос «уточните <категория>». Допустимые значения (выбирай только из этого списка):
  - material — основной материал товара (пластик/металл/ткань/дерево...)
  - composition — состав смеси/процентное соотношение материалов (актуально для текстиля и сплавов)
  - purpose — назначение товара (что им делают, для чего он)
  - dimensions — габариты/объём/мощность/масса/ёмкость
  - electrical — есть ли электрическая часть / питание / встроенный мотор
  - age_group — возрастная группа (детское/взрослое — критично для одежды и игрушек)
  - form_factor — форм-фактор / тип конструкции (готовое изделие vs запчасть, упаковка vs содержимое)
  - origin — страна/тип производителя (актуально для квот и преференций)
  - application — отрасль применения (бытовое/промышленное/медицинское/декоративное)
  Не выдумывай категории вне списка. При высокой уверенности оставляй массив пустым.

Ориентиры по разделам ТН ВЭД (для быстрой локализации группы):
- 01-05 — живые животные и продукты животного происхождения
- 06-14 — продукты растительного происхождения
- 15 — жиры и масла
- 16-24 — готовые продукты питания, напитки, табак
- 25-27 — минеральное сырьё, топливо
- 28-38 — продукция химической промышленности (включая косметику 33, мыло 34, реактивы)
- 39-40 — пластмассы (39) и резина (40)
- 41-43 — кожа, меха и изделия из них
- 44-46 — древесина, пробка, плетёные изделия
- 47-49 — целлюлоза, бумага, печатная продукция
- 50-63 — текстиль: 50 шёлк, 51 шерсть, 52 хлопок, 54-55 синтетика и штапель, 56-60 специальный текстиль и трикотаж, 61 одежда трикотажная, 62 одежда не-трикотажная, 63 готовые текстильные изделия
- 64-67 — обувь (64), головные уборы (65), зонты, перья
- 68-70 — камень, керамика (69), стекло (70)
- 71 — жемчуг, драгоценные камни и металлы, бижутерия
- 72-83 — чёрные и цветные металлы и изделия из них (73 — изделия из чёрных металлов, 76 — алюминий, 82 — инструмент, 83 — прочие изделия из недрагоценных металлов)
- 84 — механическое оборудование, машины (включая бытовую технику без электрики)
- 85 — электрические машины и аппаратура (провода, наушники, зарядки, гаджеты)
- 86-89 — транспортные средства (87 — автомобили и части)
- 90 — оптические, измерительные приборы, медтехника
- 91 — часы
- 92 — музыкальные инструменты
- 93 — оружие
- 94 — мебель, светильники, матрацы (9401 — сидячая мебель, 9403 — прочая мебель, 9405 — светильники)
- 95 — игрушки, игры, спортинвентарь (9503 — игрушки детские, 9504 — настольные игры, 9506 — спортинвентарь)
- 96 — разные готовые изделия (щётки, пуговицы, авторучки, изделия гигиены)

Примеры классификации:
- «Кожаная женская сумочка» + rawContext «натуральная кожа, подкладка текстиль» → 4202211000 (сумки с наружной поверхностью из натуральной кожи). Ключ: материал — натуральная кожа → 4202.
- «Детская игрушка со звуковыми эффектами, пластик» → 9503005500 (игрушки с моторчиком/электрикой). Ключ: игрушка + электроника → 9503, подкатегория 00 55 «прочие с мотором/электроникой».
- «Bluetooth-наушники» → 8518302000 (наушники головные). Ключ: акустическое устройство 8518 (не 8517 телефония).
- «Футболка хлопковая женская, трикотаж» → 6109100010. Ключ: трикотаж → 61 (не 62), 6109 — футболки.
- «Электрочайник 1.5л, нержавеющая сталь, 1500W» → 8516710000. Ключ: водонагревательный электроприбор → 8516 (не 84, т.к. электрика).
- «Набор LEGO-конструктор» → 9503003500 (игрушки-конструкторы пластмассовые). Ключ: игрушка + пластмасса + конструктор.

Критерии confidence:
- 0.9-1.0 — кандидат из TKS полностью совпадает с товаром по материалу и функции; либо hsCode от автора файла валиден и соответствует.
- 0.7-0.9 — кандидат подходит по функции, но есть малая неопределённость по подкатегории (например, неясен материал подкладки).
- 0.5-0.7 — описание расплывчатое или несколько кандидатов одинаково подходят; выбран наиболее вероятный.
- < 0.5 — недостаточно данных для уверенной классификации, код предложен как best guess.

Типовые ошибки — чего избегать:
- Не путать 61 (трикотаж) и 62 (не-трикотаж). Трикотажные футболки, джемперы — всегда 61, даже если в описании нет слова «трикотаж», но указан тип ткани jersey/knit.
- Не относить предметы с электрикой в группу 84 — для них группа 85, кроме специфических исключений (84 — это механика без электрики в основе функции).
- Не выбирать подкатегорию «прочее» если есть более точное соответствие. TKS иногда возвращает более широкие кандидаты, но если по описанию видна точная подгруппа — предпочесть её.
- Для материалосмешанных изделий приоритет — материал, определяющий главную стоимость/функцию (кожаный ремень с металлической пряжкой — 4203, не 7326).
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
            alternatives: {
              type: 'array',
              maxItems: 2,
              description:
                'До 2 альтернативных 10-значных кодов, которые ты также рассматривал в этой классификации. ' +
                'Заполняй ТОЛЬКО если confidence ниже confidenceThreshold (поле передаётся в каждом item) ' +
                'или если несколько кандидатов TKS близки по релевантности. ' +
                'При высокой уверенности (заметно выше порога) оставляй пустым.',
              items: {
                type: 'object',
                properties: {
                  tnVedCode: { type: 'string', description: '10-значный код ТН ВЭД альтернативы' },
                  confidence: { type: 'number', description: '0.0-1.0 — твоя уверенность в этой альтернативе' },
                  reasoning: {
                    type: 'string',
                    description:
                      'Одна короткая фраза на русском: чем альтернатива отличается от выбранного кода ' +
                      'и почему ты её всё-таки не выбрал.',
                  },
                  reasoning_localized: {
                    type: 'string',
                    description: 'То же на языке пользователя (если language≠ru)',
                  },
                },
                required: ['tnVedCode', 'confidence', 'reasoning'],
              },
            },
            missingDataCategories: {
              type: 'array',
              maxItems: 3,
              description:
                'Категории данных, которых тебе не хватило для уверенной классификации. ' +
                'Заполняй ТОЛЬКО при confidence < confidenceThreshold. Выбирай 1-3 наиболее критичные. ' +
                'Используй только значения из enum, не выдумывай новые. ' +
                'При confidence заметно выше порога оставляй массив пустым.',
              items: {
                type: 'string',
                enum: [...MISSING_DATA_CATEGORIES],
              },
            },
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

interface VisionResult {
  tnVedCode: string;
  confidence: number;
  comment: string;
  commentLocalized?: string;
}

const VISION_SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации ТН ВЭД, который верифицирует решение по фотографии товара.

Тебе дают: текстовое описание товара, текущий выбранный 10-значный код ТН ВЭД и фотографию реального товара.

Задача — посмотреть на фото и:
1. Подтвердить текущий код, если фото соответствует описанию и коду — верни тот же tnVedCode с повышенной confidence.
2. Скорректировать код, если фото показывает другой материал/тип товара (например, "Шлейка" в описании, а на фото поводки; "ступица колеса" в описании, а на фото литой диск). Верни новый 10-значный tnVedCode.

Что можно понять по фото товара: материал (металл/пластик/дерево/ткань), тип изделия (готовый продукт vs упаковка vs части), назначение (бытовое/промышленное/детское), наличие электрики, форм-фактор. Используй это для уточнения группы ТН ВЭД.

confidence: 0.0–1.0 — твоя уверенность по итогу (с учётом фото).
comment: 1-2 фразы на русском о том, что увидел на фото и почему это соответствует или не соответствует коду.
`;

const VISION_TOOL: Anthropic.Messages.Tool = {
  name: 'verify_with_photo',
  description: 'Подтверждение или корректировка кода ТН ВЭД по фотографии товара',
  input_schema: {
    type: 'object' as const,
    properties: {
      tnVedCode: { type: 'string', description: '10-значный код ТН ВЭД' },
      confidence: { type: 'number', description: '0.0–1.0' },
      comment: { type: 'string', description: 'Что видно на фото и почему код подходит/не подходит' },
      comment_localized: {
        type: 'string',
        description: 'Тот же комментарий на языке пользователя (если language≠ru)',
      },
    },
    required: ['tnVedCode', 'confidence', 'comment'],
  },
};

@Injectable()
export class ClassifierService {
  private logger = new Logger(ClassifierService.name);
  private classificationCache = new Map<string, { data: ClaudeSelection; expiresAt: number }>();
  private visionCache = new Map<string, { data: VisionResult; expiresAt: number }>();

  constructor(
    private tksApi: TksApiClient,
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private aiConfig: AiConfigService,
    private audit: PipelineAuditService,
    // Без явного @Inject(PhotoStorageService) NestJS в production не резолвит
    // тип `PhotoStorageService | null` — параметр приходит null и vision-retry
    // молча отключается (наблюдалось на stage).
    @Optional() @Inject(PhotoStorageService) private photoStorage: PhotoStorageService | null = null,
  ) {}

  async classify(
    products: ProductRow[],
    language?: string,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
    auditContext: AuditContext | null = null,
  ): Promise<{
    products: ClassifiedProduct[];
    tokenUsage: TokenUsageMap;
    audit: ClassifierAudit;
    usedFallback: boolean;
  }> {
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
        this.formulateSearchQueries(uniqueProducts, auditContext),
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
        auditContext,
        confidenceThreshold,
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
    const queriesByProduct = products.map((_, i) => searchQueries[originalToUnique[i]] ?? []);

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
      // Альтернативы Claude — подгружаем их ставки сразу, чтобы оператор в админке
      // увидел dutyRate/vatRate/exciseRate каждого варианта без отдельного запроса.
      for (const alt of sel?.alternatives ?? []) {
        if (alt.tnVedCode && !tnvedByCode.has(alt.tnVedCode)) codesToLoad.add(alt.tnVedCode);
      }
    }
    const loadedRates = await this.loadTnvedRates([...codesToLoad]);
    for (const [code, tnved] of loadedRates) {
      tnvedByCode.set(code, tnved);
    }

    // Phase 3.5: одна попытка retry для позиций, где Claude выдал код, которого нет в TKS.
    // Без этого assembleResults уйдёт в unmatched (matchConfidence=0), и при
    // low_confidence_action='reject' даже одна такая позиция валит весь документ —
    // хотя у нас на руках есть TKS-кандидаты, из которых Claude мог бы выбрать.
    if (this.anthropic) {
      const retryItems: {
        uniqueIdx: number;
        product: ProductRow;
        candidates: TksCandidate[];
        failedCode: string;
      }[] = [];
      for (let i = 0; i < uniqueProducts.length; i++) {
        const sel = uniqueSelections[i];
        const candidates = uniqueCandidates[i];
        if (
          sel &&
          sel.tnVedCode &&
          !tnvedByCode.has(sel.tnVedCode) &&
          candidates.length > 0
        ) {
          retryItems.push({
            uniqueIdx: i,
            product: uniqueProducts[i],
            candidates,
            failedCode: sel.tnVedCode,
          });
        }
      }

      if (retryItems.length > 0) {
        this.logger.log(
          `Classifier retry: ${retryItems.length} unique products with codes not in TKS`,
        );
        const { selections: retrySels, tokenUsage: retryUsage } = await this.retryUnmatchedClaude(
          retryItems,
          language,
          auditContext,
          confidenceThreshold,
        );
        tokenUsage = mergeTokenUsage(tokenUsage, retryUsage);

        const newCodesToLoad = new Set<string>();
        for (const item of retryItems) {
          const newSel = retrySels.get(item.uniqueIdx);
          if (!newSel) continue;
          uniqueSelections[item.uniqueIdx] = newSel;
          const cacheKey = this.buildProductKey(item.product, classifierModel);
          this.classificationCache.set(cacheKey, {
            data: newSel,
            expiresAt: now + CLASSIFICATION_CACHE_TTL,
          });
          if (newSel.tnVedCode && !tnvedByCode.has(newSel.tnVedCode)) {
            newCodesToLoad.add(newSel.tnVedCode);
          }
          for (const alt of newSel.alternatives ?? []) {
            if (alt.tnVedCode && !tnvedByCode.has(alt.tnVedCode)) {
              newCodesToLoad.add(alt.tnVedCode);
            }
          }
        }

        // Re-map selections per original product after dedup mapping
        for (let i = 0; i < products.length; i++) {
          selections[i] = uniqueSelections[originalToUnique[i]];
        }

        if (newCodesToLoad.size > 0) {
          const moreLoaded = await this.loadTnvedRates([...newCodesToLoad]);
          for (const [code, tnved] of moreLoaded) {
            tnvedByCode.set(code, tnved);
          }
        }
      }
    }

    // Phase 4: Assemble results
    const assembled = assembleResults(
      products,
      candidatesByProduct,
      selections,
      tnvedByCode,
      language,
      confidenceThreshold,
    );

    // Phase 4.5: фото фактчекит код для строк с низкой текстовой уверенностью.
    const { tokenUsage: visionUsage } = await this.runVisionRetry(
      assembled,
      confidenceThreshold,
      language,
      auditContext,
    );
    tokenUsage = mergeTokenUsage(tokenUsage, visionUsage);

    const matched = assembled.filter((p) => p.matched).length;
    this.logger.log(
      `Classification done: ${matched}/${assembled.length} matched, ${codesToLoad.size} unique codes`,
    );
    const usedFallback = assembled.some((p) => !p.matched || !p.verified);
    return {
      products: assembled,
      tokenUsage,
      audit: {
        searchQueries: queriesByProduct,
        tksCandidates: candidatesByProduct,
        selections,
      },
      usedFallback,
    };
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
    auditContext: AuditContext | null = null,
  ): Promise<{ queries: string[][]; tokenUsage: TokenUsageMap }> {
    // Дефолт — сырое описание. Перезаписывается на запросы Claude по тем индексам,
    // для которых соответствующий батч успел отработать. Если батч упал в timeout
    // (Opus на 49 товарах в один присест уходил за 45с × 3 SDK-ретрая = ~135с),
    // только эти товары останутся с raw fallback, остальные сохранят качественные запросы.
    const queries = products.map((p) => [p.description]);
    if (!this.anthropic || products.length === 0) {
      return { queries, tokenUsage: emptyTokenUsageMap() };
    }

    type FormulateItem = { index: number; description: string; context?: string };
    const allItems: FormulateItem[] = products.map((p, i) => ({
      index: i,
      description: p.description,
      ...(p.rawContext ? { context: p.rawContext } : {}),
    }));

    const batches: FormulateItem[][] = [];
    for (let i = 0; i < allItems.length; i += CLAUDE_BATCH_SIZE) {
      batches.push(allItems.slice(i, i + CLAUDE_BATCH_SIZE));
    }
    const useCache = batches.length > 1;

    let totalUsage = emptyTokenUsageMap();
    let formulatedCount = 0;

    const applyResult = (
      batchItems: FormulateItem[],
      result: { queries: Map<number, string[]>; tokenUsage: TokenUsageMap },
    ) => {
      totalUsage = mergeTokenUsage(totalUsage, result.tokenUsage);
      for (const item of batchItems) {
        const formulated = result.queries.get(item.index);
        if (formulated && formulated.length > 0) {
          queries[item.index] = formulated;
          formulatedCount++;
        }
      }
    };

    // Первый батч последовательно — прогревает prompt-cache для остальных
    if (batches.length > 0) {
      const result = await this.callClaudeForQueries(batches[0], useCache, auditContext).catch(
        (err) => {
          this.logger.warn(`Query formulation batch 1/${batches.length} failed: ${errMsg(err)}`);
          return { queries: new Map<number, string[]>(), tokenUsage: emptyTokenUsageMap() };
        },
      );
      applyResult(batches[0], result);
    }

    const remaining = batches.slice(1);
    for (let g = 0; g < remaining.length; g += CLAUDE_CONCURRENCY) {
      const group = remaining.slice(g, g + CLAUDE_CONCURRENCY);
      const results = await Promise.all(
        group.map((items, j) =>
          this.callClaudeForQueries(items, useCache, auditContext).catch((err) => {
            this.logger.warn(
              `Query formulation batch ${2 + g + j}/${batches.length} failed: ${errMsg(err)}`,
            );
            return { queries: new Map<number, string[]>(), tokenUsage: emptyTokenUsageMap() };
          }),
        ),
      );
      for (let j = 0; j < group.length; j++) {
        applyResult(group[j], results[j]);
      }
    }

    const model = await this.aiConfig.getQueryFormulationModel();
    this.logger.log(
      `Formulated ${formulatedCount}/${products.length}×${QUERIES_PER_PRODUCT} search queries via ${model} in ${batches.length} batches`,
    );
    return { queries, tokenUsage: totalUsage };
  }

  private async callClaudeForQueries(
    items: { index: number; description: string; context?: string }[],
    useCache: boolean,
    auditContext: AuditContext | null,
  ): Promise<{ queries: Map<number, string[]>; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getQueryFormulationModel();
    const response = await this.audit.trackAiCall(
      {
        context: auditContext,
        purpose: 'classify_formulate_queries',
        model,
        request: {
          model,
          max_tokens: 16384,
          system: QUERY_FORMULATION_SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify(items) }],
          tools: [FORMULATE_QUERIES_TOOL.name],
          tool_choice: 'any',
          batchSize: items.length,
          indices: items.map((i) => i.index),
        },
      },
      () =>
        this.anthropic!.messages.create(
          {
            model,
            max_tokens: 16384,
            system: systemPrompt(QUERY_FORMULATION_SYSTEM),
            messages: [{ role: 'user', content: JSON.stringify(items) }],
            tools: cacheTools([FORMULATE_QUERIES_TOOL], useCache),
            tool_choice: { type: 'any' },
          },
          { timeout: CLAUDE_TIMEOUT_PIPELINE_MS },
        ),
    );

    const products = extractToolInputArrayField<{ index: number; queries: string[] }>(
      response,
      'products',
    );
    const queryMap = new Map<number, string[]>();
    const tokenUsage = tokenUsageFromResponse(model, response.usage);
    if (!products) {
      this.logger.error(
        `Claude formulate_queries response missing "products" array (batch=${items.length}, stop=${response.stop_reason})`,
      );
      return { queries: queryMap, tokenUsage };
    }
    for (const p of products) {
      queryMap.set(p.index, p.queries);
    }
    return { queries: queryMap, tokenUsage };
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
    auditContext: AuditContext | null = null,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
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
        const { selections, tokenUsage } = await this.callClaude(
          batches[0],
          language,
          useCache,
          auditContext,
          { confidenceThreshold },
        );
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
          this.callClaude(items, language, useCache, auditContext, { confidenceThreshold }).catch((err) => {
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

  private async retryUnmatchedClaude(
    retryItems: {
      uniqueIdx: number;
      product: ProductRow;
      candidates: TksCandidate[];
      failedCode: string;
    }[],
    language: string | undefined,
    auditContext: AuditContext | null,
    confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  ): Promise<{ selections: Map<number, ClaudeSelection>; tokenUsage: TokenUsageMap }> {
    const newSelections = new Map<number, ClaudeSelection>();
    let totalUsage = emptyTokenUsageMap();

    const batches: (typeof retryItems)[] = [];
    for (let i = 0; i < retryItems.length; i += CLAUDE_BATCH_SIZE) {
      batches.push(retryItems.slice(i, i + CLAUDE_BATCH_SIZE));
    }
    const useCache = batches.length > 1;

    for (const batch of batches) {
      try {
        const items: ClassifyItem[] = batch.map((b, idx) => ({
          index: idx,
          description: b.product.description,
          candidates: b.candidates,
          ...(b.product.rawContext ? { rawContext: b.product.rawContext } : {}),
          previousCode: b.failedCode,
        }));
        const { selections, tokenUsage } = await this.callClaude(
          items,
          language,
          useCache,
          auditContext,
          {
            purpose: 'classify_retry',
            promptIntro: CLASSIFIER_RETRY_PROMPT_INTRO,
            confidenceThreshold,
          },
        );
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        for (const sel of selections) {
          if (sel.index >= 0 && sel.index < batch.length) {
            newSelections.set(batch[sel.index].uniqueIdx, sel);
          }
        }
      } catch (err) {
        this.logger.error('Classifier retry batch failed', err);
      }
    }

    return { selections: newSelections, tokenUsage: totalUsage };
  }

  private async callClaude(
    items: ClassifyItem[],
    language?: string,
    useCache = false,
    auditContext: AuditContext | null = null,
    opts: {
      purpose?: AiCallPurpose;
      promptIntro?: string;
      confidenceThreshold?: number;
    } = {},
  ): Promise<{ selections: ClaudeSelection[]; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getClassifierModel();
    const needsLocalized = language && language !== 'ru';
    const localizedInstruction = needsLocalized
      ? `\nДополнительно: для каждого товара добавь comment_localized — пояснение на ${localizedLanguageName(language)} языке.`
      : '';

    const purpose: AiCallPurpose = opts.purpose ?? 'classify';
    const intro = opts.promptIntro ?? 'Классифицируй товары по ТН ВЭД';
    const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    // Прокидываем порог уверенности в каждый item, чтобы Claude применял его при
    // решении заполнять ли alternatives. Положили внутрь JSON (а не отдельным
    // постфиксом), чтобы клиент-парсеры user-prompt в тестах продолжали работать.
    const itemsWithThreshold = items.map((it) => ({ ...it, confidenceThreshold: threshold }));
    const userPrompt = `${intro}: ${JSON.stringify(itemsWithThreshold, null, 2)}${localizedInstruction}`;

    const response = await this.audit.trackAiCall(
      {
        context: auditContext,
        purpose,
        model,
        request: {
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
          tools: [CLASSIFY_TOOL.name],
          tool_choice: 'any',
          batchSize: items.length,
          indices: items.map((i) => i.index),
        },
      },
      () =>
        this.anthropic!.messages.create(
          {
            model,
            max_tokens: 4096,
            system: systemPrompt(SYSTEM_PROMPT),
            messages: [{ role: 'user', content: userPrompt }],
            tools: cacheTools([CLASSIFY_TOOL], useCache),
            tool_choice: { type: 'any' },
          },
          { timeout: CLAUDE_TIMEOUT_PIPELINE_MS },
        ),
    );

    const selections = extractToolInputArrayField<ClaudeSelection>(response, 'items');
    const tokenUsage = tokenUsageFromResponse(model, response.usage);
    if (!selections) {
      this.logger.error(
        `Claude classify response missing "items" array (purpose=${purpose}, batch=${items.length}, stop=${response.stop_reason})`,
      );
      return { selections: [], tokenUsage };
    }
    return { selections, tokenUsage };
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

  private async runVisionRetry(
    assembled: ClassifiedProduct[],
    confidenceThreshold: number,
    language: string | undefined,
    auditContext: AuditContext | null,
  ): Promise<{ tokenUsage: TokenUsageMap; applied: number }> {
    const skip = (reason: string) => {
      this.logger.log(`Vision retry skipped: ${reason}`);
      return { tokenUsage: emptyTokenUsageMap(), applied: 0 };
    };

    if (!this.anthropic) return skip('no Anthropic client');
    if (!this.photoStorage) return skip('PhotoStorage not wired');
    const documentId = auditContext?.documentId;
    if (!documentId) return skip('auditContext.documentId missing');

    const lowConfIndices: number[] = [];
    for (let i = 0; i < assembled.length; i++) {
      const p = assembled[i];
      if (!p.matched || p.matchConfidence < confidenceThreshold) lowConfIndices.push(i);
    }
    if (lowConfIndices.length === 0) {
      return skip(`no low-confidence rows (threshold=${confidenceThreshold})`);
    }

    const photos = await this.photoStorage.getFirstByRows(documentId, lowConfIndices);
    if (photos.length === 0) {
      return skip(`${lowConfIndices.length} low-conf rows but no photos in document_photo`);
    }

    const photoByRow = new Map<number, DocumentPhoto>();
    for (const ph of photos) photoByRow.set(ph.rowIndex, ph);

    const tasks = lowConfIndices
      .map((i) => ({ index: i, photo: photoByRow.get(i) }))
      .filter((t): t is { index: number; photo: DocumentPhoto } => !!t.photo);
    if (tasks.length === 0) {
      const lowConf = lowConfIndices.join(',');
      const photoRows = photos.map((p) => p.rowIndex).join(',');
      return skip(`photos exist but rowIndex mismatch (lowConf=${lowConf}, photoRows=${photoRows})`);
    }

    const model = await this.aiConfig.getPhotoClassifierModel();
    let totalUsage = emptyTokenUsageMap();

    type TaskResult = { task: { index: number; photo: DocumentPhoto }; result: VisionResult | null };
    const completed: TaskResult[] = [];
    for (let g = 0; g < tasks.length; g += VISION_CONCURRENCY) {
      const batch = tasks.slice(g, g + VISION_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (t): Promise<TaskResult & { tokenUsage: TokenUsageMap }> => {
          const product = assembled[t.index];
          const cacheKey = [t.photo.imageHash, product.tnVedCode, language ?? 'ru', model].join('\x1F');
          const now = Date.now();
          const cached = this.visionCache.get(cacheKey);
          if (cached && cached.expiresAt > now) {
            return { task: t, result: cached.data, tokenUsage: emptyTokenUsageMap() };
          }
          try {
            const { result, tokenUsage } = await this.executeVisionCall(
              product,
              t.photo,
              model,
              language,
              auditContext,
            );
            if (result) {
              this.visionCache.set(cacheKey, {
                data: result,
                expiresAt: now + CLASSIFICATION_CACHE_TTL,
              });
            }
            return { task: t, result, tokenUsage };
          } catch (err) {
            this.logger.warn(`Vision call failed for row ${t.index}: ${errMsg(err)}`);
            return { task: t, result: null, tokenUsage: emptyTokenUsageMap() };
          }
        }),
      );
      for (const r of batchResults) {
        totalUsage = mergeTokenUsage(totalUsage, r.tokenUsage);
        completed.push({ task: r.task, result: r.result });
      }
    }

    // Один батчевый loadTnvedRates под все новые коды — иначе N последовательных
    // обращений к TKS (через кэш PgTksCacheStore это дёшево, но всё равно лишние round-trips).
    const newCodesSet = new Set<string>();
    for (const r of completed) {
      if (!r.result) continue;
      const next = r.result.tnVedCode;
      const current = assembled[r.task.index].tnVedCode;
      if (next && next !== current) newCodesSet.add(next);
    }
    const tnvedByNewCode = newCodesSet.size > 0
      ? await this.loadTnvedRates([...newCodesSet])
      : new Map<string, TnvedCode>();

    let confirmed = 0;
    let corrected = 0;
    let emptyResults = 0;
    let codesNotInTks = 0;
    for (const r of completed) {
      if (!r.result) {
        emptyResults++;
        continue;
      }
      const before = assembled[r.task.index];
      const updated = this.applyVisionUpdate(before, r.result, tnvedByNewCode);
      if (updated) {
        assembled[r.task.index] = updated;
        if (r.result.tnVedCode === before.tnVedCode) confirmed++;
        else corrected++;
      } else if (r.result.tnVedCode && r.result.tnVedCode !== before.tnVedCode) {
        codesNotInTks++;
      }
    }

    this.evictExpiredVisionCache();
    const applied = confirmed + corrected;
    this.logger.log(
      `Vision retry done: tasks=${tasks.length}, confirmed=${confirmed}, corrected=${corrected}, emptyResults=${emptyResults}, codesNotInTks=${codesNotInTks}`,
    );
    return { tokenUsage: totalUsage, applied };
  }

  private async executeVisionCall(
    product: ClassifiedProduct,
    photo: DocumentPhoto,
    model: string,
    language: string | undefined,
    auditContext: AuditContext | null,
  ): Promise<{ result: VisionResult | null; tokenUsage: TokenUsageMap }> {
    if (!this.anthropic) return { result: null, tokenUsage: emptyTokenUsageMap() };

    const localizedHint =
      language && language !== 'ru'
        ? `\nДополнительно: верни comment_localized на ${localizedLanguageName(language)}.`
        : '';
    const userText =
      `Подтверди или скорректируй код ТН ВЭД для товара по фотографии.\n\n` +
      `Текущее описание: ${product.description}\n` +
      (product.rawContext ? `Контекст: ${product.rawContext}\n` : '') +
      `Текущий код: ${product.tnVedCode || '(не определён)'} — ${product.tnVedDescription}\n` +
      `Текущая уверенность: ${product.matchConfidence.toFixed(2)}\n\n` +
      `Если фото подтверждает текущий код — верни тот же tnVedCode и подними confidence. ` +
      `Если фото противоречит описанию (например, фактический материал/тип товара другой) — ` +
      `предложи более подходящий 10-значный код. ` +
      `В comment кратко объясни, что увидел на фото и почему это соответствует или не соответствует коду.${localizedHint}`;

    const sdkMessages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/jpeg' as const,
              data: photo.bytes.toString('base64'),
            },
          },
          { type: 'text' as const, text: userText },
        ],
      },
    ];

    // В audit пишем легковесный request — без base64-байтов, иначе ai_call.request
    // распухнет на ~270 KB на каждый vision-вызов.
    const auditRequest = {
      model,
      max_tokens: 1024,
      system: VISION_SYSTEM_PROMPT,
      prompt: userText,
      photoHash: photo.imageHash,
      photoSizeBytes: photo.bytes.length,
      tools: [VISION_TOOL.name],
      tool_choice: 'any',
    };

    const response = await this.audit.trackAiCall(
      {
        context: auditContext,
        purpose: 'classify_vision',
        model,
        request: auditRequest,
      },
      () =>
        this.anthropic!.messages.create(
          {
            model,
            max_tokens: 1024,
            system: systemPrompt(VISION_SYSTEM_PROMPT),
            messages: sdkMessages,
            tools: [VISION_TOOL],
            tool_choice: { type: 'any' },
          },
          { timeout: CLAUDE_TIMEOUT_PIPELINE_MS },
        ),
    );

    const parsed = extractToolInput<{
      tnVedCode: string;
      confidence: number;
      comment: string;
      comment_localized?: string;
    }>(response);
    return {
      result: {
        tnVedCode: String(parsed.tnVedCode ?? '').replace(/\D/g, ''),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        comment: String(parsed.comment ?? ''),
        commentLocalized: parsed.comment_localized
          ? String(parsed.comment_localized)
          : undefined,
      },
      tokenUsage: tokenUsageFromResponse(model, response.usage),
    };
  }

  private applyVisionUpdate(
    product: ClassifiedProduct,
    vision: VisionResult,
    tnvedByNewCode: Map<string, TnvedCode>,
  ): ClassifiedProduct | null {
    const sameCode = vision.tnVedCode && vision.tnVedCode === product.tnVedCode;
    const newCode = vision.tnVedCode && vision.tnVedCode !== product.tnVedCode ? vision.tnVedCode : null;
    if (!sameCode && !newCode) return null;

    const newTnved = newCode ? tnvedByNewCode.get(newCode) : undefined;
    if (newCode && !newTnved) {
      // Vision предложил код вне справочника — не применяем (как в text-retry).
      return null;
    }

    const note: ProductNote = {
      stage: 'classify',
      severity: 'info',
      field: 'code',
      message: sameCode
        ? `Фото подтвердило код ${product.tnVedCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.comment}`
        : `Фото скорректировало код ${product.tnVedCode || '(не определён)'} → ${newCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.comment}`,
      messageLocalized: vision.commentLocalized
        ? sameCode
          ? `Photo confirmed code ${product.tnVedCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.commentLocalized}`
          : `Photo corrected code ${product.tnVedCode || '(none)'} → ${newCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.commentLocalized}`
        : undefined,
    };

    if (sameCode) {
      return {
        ...product,
        matchConfidence: Math.max(product.matchConfidence, vision.confidence),
        verified: true,
        notes: [...product.notes, note],
      };
    }

    return {
      ...product,
      ...buildRateFields(newTnved!),
      matchConfidence: vision.confidence,
      matched: true,
      tnvedRaw: newTnved!,
      verified: true,
      suggestedCode: null,
      verificationComment: vision.comment,
      notes: [...product.notes, note],
    };
  }

  private evictExpiredVisionCache(): void {
    if (this.visionCache.size <= CLASSIFICATION_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this.visionCache) {
      if (entry.expiresAt <= now) this.visionCache.delete(key);
    }
  }

}
