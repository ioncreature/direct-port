import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { cacheTools, extractToolInput, systemPrompt } from '../common/claude';
import { errMsg } from '../common/errors';
import { normalizeOksmtCode } from '../common/oksmt';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, tokenUsageFromResponse } from '../common/token-usage';
import type { Dimension } from '../duty-interpreter/interfaces';
import { SpreadsheetData, SpreadsheetReaderService } from './spreadsheet-reader.service';

export interface ParsedProduct {
  description: string;
  price: number;
  weight: number;
  quantity: number;
  dimensions?: Dimension[];
  hsCode?: string;
  rawContext?: string;
  [key: string]: unknown;
}

export type ParseFeasibility = 'ok' | 'review' | 'rejected';

/** Источник предположения о стране происхождения. */
export type CountryDetectionSource = 'ai_explicit' | 'ai_language' | 'ai_currency';

export interface CountrySuggestion {
  /** OKSMT-код (3 цифры). */
  code: string;
  source: CountryDetectionSource;
  /** Объяснение на русском: почему выбрана именно эта страна. */
  reason: string;
}

export interface AiParseResult {
  products: ParsedProduct[];
  currency: string;
  columnMapping: Record<string, number>;
  /** 'ok' — уверенный результат, 'review' — сомнительный, 'rejected' — данные непригодны */
  feasibility: ParseFeasibility;
  /** Причины отклонения (при rejected) или замечания (при review). Пустой для ok. */
  rejectionReasons: string[];
  /** Предположение AI о стране происхождения товара. null — не удалось определить. */
  countrySuggestion: CountrySuggestion | null;
  tokenUsage: TokenUsageMap;
}

type RawParseResult = Omit<AiParseResult, 'feasibility' | 'rejectionReasons' | 'tokenUsage' | 'countrySuggestion'> & {
  countrySuggestion?: CountrySuggestion | null;
};

interface ValidationResult {
  valid: boolean;
  issues: string[];
}

const VALID_CURRENCIES = new Set([
  'CNY',
  'USD',
  'EUR',
  'RUB',
  'GBP',
  'JPY',
  'KRW',
  'TRY',
  'AED',
  'THB',
  'VND',
  'INR',
  'BRL',
  'KZT',
  'BYN',
  'UAH',
  'UZS',
  'GEL',
]);

const round4 = (v: number) => Math.round(v * 10000) / 10000;

const MAX_ROWS = 400;
const CHUNK_SIZE = 100;
const CHUNK_CONCURRENCY = 2;
const SAMPLE_ROWS = 5;
const MAX_ATTEMPTS = 2;
/** Максимальный размер TSV-данных в символах (~50K токенов). Защита от вредоносных файлов с огромным текстом в ячейках. */
const MAX_TSV_LENGTH = 200_000;
const MAX_RAW_CONTEXT_CELL_CHARS = 500;

const VALIDATION_OK_PHRASES = [
  'ошибки нет', 'ошибок нет', 'значение верно', 'значение верное',
  'значение корректно', 'совпадает', 'исправление не требуется',
  'всё корректно', 'всё верно', 'не является ошибкой',
];

// Валидатор видит лишь выборку (SAMPLE_ROWS), поэтому его суждения о полноте
// списка товаров нельзя принимать за ошибку. Полнота проверяется в checkDeterministic.
const VALIDATION_OUT_OF_SCOPE_PHRASES = [
  'несуществующий', 'несуществующую', 'несуществующих',
  'лишний товар', 'лишняя строка', 'лишних товар',
  'добавлен', 'добавлена строка',
  'пропущен', 'пропуск',
  'в исходных данных только', 'в исходных данных всего',
  'товарных строк', 'товарных строки',
];

interface DocumentStructure {
  headerRows: number[];
  dataRows: number[];
  columnMapping: Record<string, number>;
  currency: string;
  weightNote: string;
  countrySuggestion?: CountrySuggestion | null;
}

const SYSTEM_PROMPT = `Ты — эксперт по парсингу коммерческих документов для импорта товаров.

Твоя задача — проанализировать таблицу с данными о товарах и извлечь структурированную информацию.

Правила:
1. Определи валюту цен по символам (¥/$/€/₽) или по контексту (китайские товары = CNY, если не указано иное)
2. Найди колонки с наименованиями товаров, ценами за единицу, весом и количеством
3. Если наименования не на русском — переведи на русский. Транслитерация НЕ допускается, нужен смысловой перевод
4. Если количество вычисляется из нескольких колонок (например, коробки × штук/коробку) — используй итоговое количество
5. Вес должен быть за ОДНУ единицу товара в килограммах. Если в таблице указан общий вес позиции — раздели на количество. Используй здравый смысл: одна фритюрница не может весить 2600 кг, но вполне может весить 5 кг
6. Цена должна быть за одну единицу товара в исходной валюте
7. Пропусти итоговые/суммарные строки (ИТОГО, 合计, Total и т.п.)
8. Пропусти пустые строки и строки без наименования товара
9. Пропусти строки-заголовки и подзаголовки
10. Если таблица содержит несколько строк заголовков (например, на двух языках) — используй их для понимания структуры, но не включай в результат
11. Если в таблице есть дополнительные числовые характеристики товара (площадь, объём, длина, объём м3 и т.д.) — извлеки их в массив dimensions с единицами измерения
12. Каждая строка таблицы — отдельная товарная позиция. НЕ объединяй и НЕ дедуплицируй строки, даже если они имеют одинаковое наименование, цену или другие параметры. Количество извлечённых товаров должно точно совпадать с количеством товарных строк в таблице
13. Числовые значения (вес, цена, количество) округляй до 4 знаков после запятой
14. Если в таблице есть колонка с кодами ТН ВЭД / HS (海关编码, HS编码, код ТН ВЭД, HS code — 6-10 цифр) — извлеки код в поле hsCode (только цифры, без точек и пробелов). Если такой колонки нет — не включай поле

`;

const VALIDATION_SYSTEM_PROMPT = `Ты — валидатор результатов парсинга коммерческих документов для импорта товаров в Россию.

Тебе предоставлена ВЫБОРКА первых нескольких исходных строк таблицы и соответствующая ВЫБОРКА первых извлечённых товаров. Проверяй пары 1-к-1 по порядку.

ВАЖНО про формат ответа:
- Поле reasoning — для ВСЕХ твоих вычислений и рассуждений. Пиши туда всё: какую колонку смотришь, какие числа сравниваешь, совпадает или нет.
- Поле issues — ТОЛЬКО реальные ошибки. Если вычислил что значение верно — НЕ добавляй его в issues, оставь только в reasoning.
- Если всё корректно: valid=true, issues=[].

Что считать ошибкой:
- Числовое расхождение: значение в parsed_result НЕ совпадает с исходными данными после пересчёта на единицу.
- Пересчёт общего веса/цены на единицу (= общий / количество) — это ПРАВИЛЬНО, не ошибка.
- Неверный перевод наименования (бессмысленный или не соответствующий оригиналу).
- Неверная валюта при наличии явных указаний (символ ¥/$€/₽).

Что НЕ считать ошибкой:
- Пропущенные итоговые строки (ИТОГО, 合计, Total).
- Отсутствующие поля (артикул, номер, габариты).
- Поля hsCode и rawContext.

КРИТИЧЕСКИ ВАЖНО: Ты видишь только ВЫБОРКУ из большего набора данных.
- НЕ делай выводов о количестве товаров (пропущенных или лишних).
- НЕ пиши в issues фразы вида "добавлен несуществующий N-й товар", "пропущена строка", "в исходных данных только K строк".
- Полнота данных проверяется отдельным механизмом, это не твоя задача.
- Твоя единственная задача — сравнить показанные пары source_rows ↔ parsed_products на соответствие значений.

`;

const CHUNK_SYSTEM_PROMPT = `Ты — эксперт по парсингу коммерческих документов для импорта товаров. Продолжай извлечение данных согласно указанным правилам.`;

const STRUCTURE_ANALYSIS_PROMPT = `Ты — эксперт по анализу структуры коммерческих документов для импорта товаров.

Определи структуру таблицы. НЕ извлекай данные — только определи формат.

1. Строки-заголовки: могут быть на нескольких языках (русский + китайский и т.д.). Перечисли все индексы.
2. Перечисли индексы ВСЕХ строк, содержащих товарные данные. Не включай: заголовки, итоги (ИТОГО, Total, 合计), пустые строки, комментарии, примечания.
3. Маппинг колонок (0-indexed): наименование, цена за единицу, вес, итоговое количество.
   - Цена: колонка с ценой за ЕДИНИЦУ товара (не стоимость партии).
   - Количество: колонка с ИТОГОВЫМ количеством (если есть коробки × штук/коробку — бери итог).
   - Вес: укажи колонку и опиши что в ней (за единицу, за коробку, общий).
4. Валюту: по символам (¥/$€/₽) или контексту.
5. Предполагаемую страну происхождения товара (опционально, countrySuggestion):
   - Код в формате OKSMT (3 цифры): 156=Китай, 792=Турция, 392=Япония, 764=Таиланд, 458=Малайзия, 410=Корея, 704=Вьетнам, 356=Индия, 840=США, 276=Германия и т.п.
   - source: 'ai_explicit' если страна прямо указана в документе (надпись "Made in ...", "Страна: ...", "Origin: ...", "产地: ..."), 'ai_language' если выводится из языка описания товара (китайский → Китай, турецкий → Турция), 'ai_currency' если только по валюте (CNY → Китай, TRY → Турция, KRW → Корея и т.п.).
   - reason: краткое объяснение (1 фраза на русском), например "Прямое упоминание «Made in China»" или "Описания на китайском языке".
   - Если нельзя уверенно определить — countrySuggestion не возвращай (оставь поле пустым).`;

const ANALYZE_STRUCTURE_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_structure',
  description: 'Результат анализа структуры коммерческого документа',
  input_schema: {
    type: 'object' as const,
    properties: {
      headerRows: {
        type: 'array',
        items: { type: 'number' },
        description: 'Индексы строк-заголовков (0-indexed)',
      },
      dataRows: {
        type: 'array',
        items: { type: 'number' },
        description: 'Индексы ВСЕХ строк с товарными данными (0-indexed). Не включай заголовки, итоги, пустые строки, комментарии',
      },
      columnMapping: {
        type: 'object',
        properties: {
          description: { type: 'number', description: 'Колонка с наименованием товара' },
          price: { type: 'number', description: 'Колонка с ценой за единицу' },
          weight: { type: 'number', description: 'Колонка с весом' },
          quantity: { type: 'number', description: 'Колонка с итоговым количеством' },
        },
        required: ['description', 'price', 'weight', 'quantity'],
      },
      currency: {
        type: 'string',
        description: 'ISO 4217 код валюты (CNY, USD, EUR и т.д.)',
      },
      weightNote: {
        type: 'string',
        description: 'Что содержит колонка веса: "per_unit" (за единицу товара), "per_box" (за коробку), "total" (общий вес позиции)',
      },
      countrySuggestion: {
        type: 'object',
        description: 'Предполагаемая страна происхождения товара. Пропусти поле, если нельзя уверенно определить.',
        properties: {
          code: {
            type: 'string',
            description: 'OKSMT-код страны, 3 цифры (156=Китай, 792=Турция, 392=Япония, 764=Таиланд, 458=Малайзия, 410=Корея, 704=Вьетнам, 356=Индия, 840=США, 276=Германия).',
          },
          source: {
            type: 'string',
            enum: ['ai_explicit', 'ai_language', 'ai_currency'],
            description: 'ai_explicit = прямое упоминание в документе; ai_language = по языку описания; ai_currency = только по валюте.',
          },
          reason: {
            type: 'string',
            description: 'Краткое объяснение (1 фраза на русском).',
          },
        },
        required: ['code', 'source', 'reason'],
      },
    },
    required: ['headerRows', 'dataRows', 'columnMapping', 'currency', 'weightNote'],
  },
};

const PRODUCT_ITEMS_SCHEMA: Anthropic.Messages.Tool['input_schema'] = {
  type: 'object' as const,
  properties: {
    description: { type: 'string', description: 'Наименование товара на русском' },
    price: { type: 'number', description: 'Цена за единицу' },
    weight: { type: 'number', description: 'Вес за единицу в кг' },
    quantity: { type: 'number', description: 'Общее количество' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
        },
        required: ['name', 'value', 'unit'],
      },
    },
    hsCode: {
      type: 'string',
      description: 'Код ТН ВЭД / HS code если указан автором (6-10 цифр, только цифры). Пропусти если нет',
    },
  },
  required: ['description', 'price', 'weight', 'quantity'],
};

const PARSE_TOOL: Anthropic.Messages.Tool = {
  name: 'parse_products',
  description: 'Извлечённые товары из таблицы коммерческого документа',
  input_schema: {
    type: 'object' as const,
    properties: {
      currency: { type: 'string', description: 'ISO 4217 код валюты (CNY, USD, EUR, RUB и т.д.)' },
      columnMapping: {
        type: 'object',
        properties: {
          description: { type: 'number' },
          price: { type: 'number' },
          weight: { type: 'number' },
          quantity: { type: 'number' },
        },
        required: ['description', 'price', 'weight', 'quantity'],
      },
      products: { type: 'array', items: PRODUCT_ITEMS_SCHEMA },
    },
    required: ['currency', 'columnMapping', 'products'],
  },
};

const PARSE_CHUNK_TOOL: Anthropic.Messages.Tool = {
  name: 'parse_products_chunk',
  description: 'Продолжение извлечения товаров из следующего блока таблицы',
  input_schema: {
    type: 'object' as const,
    properties: {
      products: { type: 'array', items: PRODUCT_ITEMS_SCHEMA },
    },
    required: ['products'],
  },
};

const VALIDATE_TOOL: Anthropic.Messages.Tool = {
  name: 'validate_parsing',
  description: 'Результат валидации парсинга коммерческого документа',
  input_schema: {
    type: 'object' as const,
    properties: {
      reasoning: { type: 'string', description: 'Твой анализ и вычисления (не показывается пользователю). Сюда пиши все рассуждения.' },
      valid: { type: 'boolean', description: 'true если ВСЕ значения корректны, false если есть хотя бы одна реальная ошибка' },
      issues: { type: 'array', items: { type: 'string' }, description: 'ТОЛЬКО реальные ошибки (расхождения). Пустой массив если всё верно. НЕ включай рассуждения и подтверждения корректности.' },
    },
    required: ['reasoning', 'valid', 'issues'],
  },
};

@Injectable()
export class AiParserService {
  private logger = new Logger(AiParserService.name);

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private spreadsheetReader: SpreadsheetReaderService,
    private aiConfig: AiConfigService,
  ) {}

  async parse(buffer: Buffer, fileName: string): Promise<AiParseResult> {
    this.logger.log(`Starting parse: file="${fileName}", buffer=${buffer.length} bytes`);

    if (!this.anthropic) {
      throw new BadRequestException('AI-парсер недоступен: ANTHROPIC_API_KEY не настроен');
    }

    const data = await this.spreadsheetReader.read(buffer, fileName, MAX_ROWS + 1);
    this.logger.log(`Spreadsheet read: ${data.rows.length} rows, ${data.columnCount} columns`);

    if (data.rows.length > MAX_ROWS) {
      this.logger.warn(`File rejected: too many rows (${data.rows.length} > ${MAX_ROWS})`);
      return this.rejected([
        `Файл содержит слишком много строк (более ${MAX_ROWS}). Пожалуйста, разделите файл на части не более ${MAX_ROWS} строк.`,
      ]);
    }

    if (data.rows.length < 2) {
      this.logger.warn(`File rejected: too few rows (${data.rows.length})`);
      return this.rejected(['Файл пустой или содержит только заголовок (менее 2 строк).']);
    }

    const tsv = this.formatAsTsv(data.rows);
    if (tsv.length > MAX_TSV_LENGTH) {
      this.logger.warn(`File rejected: content too large (${tsv.length} chars > ${MAX_TSV_LENGTH})`);
      return this.rejected([
        `Содержимое файла слишком большое (${Math.round(tsv.length / 1000)}K символов). Максимум — ${MAX_TSV_LENGTH / 1000}K. Уменьшите объём текста в ячейках или разделите файл.`,
      ]);
    }

    const { structure, tokenUsage: analysisUsage } = await this.analyzeStructure(data, tsv);

    let result: AiParseResult;
    if (data.rows.length <= CHUNK_SIZE) {
      result = await this.parseSinglePass(tsv, data, structure);
    } else {
      result = await this.parseChunked(data, structure);
    }
    result.tokenUsage = mergeTokenUsage(analysisUsage, result.tokenUsage);
    // Страна определяется из структуры, не зависит от успеха построчного парсинга.
    result.countrySuggestion = structure?.countrySuggestion ?? null;
    return result;
  }

  private async parseSinglePass(
    tsv: string,
    data: SpreadsheetData,
    structure?: DocumentStructure | null,
  ): Promise<AiParseResult> {
    let lastResult: RawParseResult | null = null;
    let lastIssues: string[] = [];
    let totalUsage = emptyTokenUsageMap();
    const expectedCount = structure ? structure.dataRows.length : undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const userPrompt =
        attempt === 1
          ? this.buildUserPrompt(tsv, structure, expectedCount)
          : this.buildRetryPrompt(tsv, lastIssues, structure, expectedCount);

      const { tokenUsage, ...result } = await this.callClaude(userPrompt);
      totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
      lastResult = result;

      if (structure) {
        lastResult.currency = structure.currency;
        lastResult.columnMapping = structure.columnMapping;
        lastResult.products = this.enrichRawContext(
          lastResult.products,
          structure.dataRows.map((i) => data.rows[i]),
          structure.columnMapping,
        );
      }

      const detIssues = this.checkDeterministic(result, data, expectedCount);
      if (detIssues.length > 0) {
        this.logger.warn(`Attempt ${attempt}: deterministic issues: ${detIssues.join('; ')}`);
        lastIssues = detIssues;
        if (attempt < MAX_ATTEMPTS) continue;
        return { ...this.assessFeasibility(result, lastIssues), tokenUsage: totalUsage };
      }

      const { tokenUsage: valUsage, ...validation } = await this.validateWithAi(
        data,
        result,
        structure,
      );
      totalUsage = mergeTokenUsage(totalUsage, valUsage);
      if (validation.valid) {
        this.logger.log(
          `Parsed ${result.products.length} products, currency=${result.currency} (attempt ${attempt})`,
        );
        return { ...result, feasibility: 'ok', rejectionReasons: [], countrySuggestion: null, tokenUsage: totalUsage };
      }

      this.logger.warn(`Attempt ${attempt}: AI validation issues: ${validation.issues.join('; ')}`);
      lastIssues = validation.issues;
    }

    this.logger.warn(
      `Returning result after ${MAX_ATTEMPTS} attempts with issues (${lastIssues.join('; ')})`,
    );
    return { ...this.assessFeasibility(lastResult!, lastIssues), tokenUsage: totalUsage };
  }

  private async parseChunked(
    data: SpreadsheetData,
    structure?: DocumentStructure | null,
  ): Promise<AiParseResult> {
    let totalUsage = emptyTokenUsageMap();

    let parseRows: string[][];
    let headerRow: string[];
    let expectedTotal: number | undefined;

    if (structure) {
      parseRows = structure.dataRows.map((i) => data.rows[i]);
      headerRow = structure.headerRows.length > 0 ? data.rows[structure.headerRows[0]] : data.rows[0];
      expectedTotal = structure.dataRows.length;
    } else {
      parseRows = data.rows;
      headerRow = data.rows[0];
    }

    const chunks: string[][][] = [];
    for (let i = 0; i < parseRows.length; i += CHUNK_SIZE) {
      chunks.push(parseRows.slice(i, Math.min(i + CHUNK_SIZE, parseRows.length)));
    }

    this.logger.log(`Parsing ${parseRows.length} data rows in ${chunks.length} chunks`);

    const firstTsv = this.formatAsTsv(chunks[0]);
    let firstResult: RawParseResult | null = null;
    let lastIssues: string[] = [];
    const expectedChunkCount = structure ? chunks[0].length : undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const prompt = attempt === 1
        ? this.buildUserPrompt(firstTsv, structure, expectedChunkCount)
        : this.buildRetryPrompt(firstTsv, lastIssues, structure, expectedChunkCount);

      const { tokenUsage, ...result } = await this.callClaude(prompt, true);
      totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
      firstResult = result;

      if (structure) {
        firstResult.currency = structure.currency;
        firstResult.columnMapping = structure.columnMapping;
        firstResult.products = this.enrichRawContext(
          firstResult.products,
          chunks[0],
          structure.columnMapping,
        );
      }

      const issues = this.checkDeterministic(
        result,
        { rows: chunks[0], columnCount: data.columnCount },
        expectedChunkCount,
      );
      if (issues.length === 0) break;

      lastIssues = issues;
      this.logger.warn(`Chunk 0 attempt ${attempt}: ${issues.join('; ')}`);
    }

    if (!firstResult || firstResult.products.length === 0) {
      return {
        ...this.assessFeasibility(
          firstResult ?? { products: [], currency: '', columnMapping: {} },
          lastIssues,
        ),
        tokenUsage: totalUsage,
      };
    }

    const allProducts = [...firstResult.products];
    const { currency, columnMapping } = firstResult;

    const remainingChunks = chunks.slice(1);
    let failedChunks = 0;

    for (let g = 0; g < remainingChunks.length; g += CHUNK_CONCURRENCY) {
      const group = remainingChunks.slice(g, g + CHUNK_CONCURRENCY);
      const results = await Promise.all(
        group.map((chunk) => {
          const chunkWithHeader = [headerRow, ...chunk];
          const chunkTsv = this.formatAsTsv(chunkWithHeader);
          return this.callClaudeChunk(chunkTsv, currency, columnMapping).catch((err) => {
            this.logger.error('Chunk parsing failed', err);
            return null;
          });
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r) {
          totalUsage = mergeTokenUsage(totalUsage, r.tokenUsage);
          const chunk = group[j];
          const enriched = this.enrichRawContext(r.products, chunk, columnMapping);
          allProducts.push(...enriched);
          this.logger.log(`Chunk ${g + j + 1}: parsed ${r.products.length} products`);
        } else {
          failedChunks++;
        }
      }
    }

    const fullResult: RawParseResult = { products: allProducts, currency, columnMapping };
    const issues: string[] = [];

    if (failedChunks > 0) {
      issues.push(
        `Не удалось обработать ${failedChunks} из ${chunks.length - 1} блоков данных, данные могут быть неполными.`,
      );
    }

    if (expectedTotal !== undefined && allProducts.length !== expectedTotal) {
      issues.push(
        `Ожидалось ${expectedTotal} товаров (по структуре), получено ${allProducts.length}`,
      );
    }

    const { tokenUsage: valUsage, ...validation } = await this.validateWithAi(data, fullResult, structure);
    totalUsage = mergeTokenUsage(totalUsage, valUsage);
    if (!validation.valid) {
      issues.push(...validation.issues);
    }

    if (issues.length > 0) {
      this.logger.warn(`Chunked parse issues: ${issues.join('; ')}`);
      return { ...this.assessFeasibility(fullResult, issues), tokenUsage: totalUsage };
    }

    this.logger.log(`Parsed ${allProducts.length} products in ${chunks.length} chunks, currency=${currency}`);
    return { ...fullResult, feasibility: 'ok', rejectionReasons: [], countrySuggestion: null, tokenUsage: totalUsage };
  }

  private async analyzeStructure(
    data: SpreadsheetData,
    tsv: string,
  ): Promise<{ structure: DocumentStructure | null; tokenUsage: TokenUsageMap }> {
    if (!this.anthropic) {
      return { structure: null, tokenUsage: emptyTokenUsageMap() };
    }

    try {
      const prompt = `Проанализируй структуру таблицы коммерческого документа.\n\n<spreadsheet_data>\n${tsv}\n</spreadsheet_data>\n\n(Всего ${data.rows.length} строк)`;

      const { raw, tokenUsage } = await this.callClaudeRaw(
        prompt,
        STRUCTURE_ANALYSIS_PROMPT,
        false,
        ANALYZE_STRUCTURE_TOOL,
        { maxTokens: 2048, timeout: 30_000 },
      );
      const result = raw as Record<string, unknown>;

      if (
        !Array.isArray(result.headerRows) ||
        !Array.isArray(result.dataRows) ||
        result.dataRows.length === 0 ||
        !result.dataRows.every((i: unknown) => typeof i === 'number' && i >= 0 && i < data.rows.length) ||
        !result.columnMapping ||
        typeof (result.columnMapping as Record<string, unknown>).description !== 'number' ||
        typeof (result.columnMapping as Record<string, unknown>).price !== 'number' ||
        typeof (result.columnMapping as Record<string, unknown>).weight !== 'number' ||
        typeof (result.columnMapping as Record<string, unknown>).quantity !== 'number'
      ) {
        this.logger.warn('Structure analysis returned invalid result, falling back');
        return { structure: null, tokenUsage };
      }

      const structure = result as unknown as DocumentStructure;
      structure.countrySuggestion = this.normalizeCountrySuggestion(result.countrySuggestion);
      this.logger.log(
        `Structure: headers=${JSON.stringify(structure.headerRows)}, dataRows=${structure.dataRows.length}, ` +
          `currency=${structure.currency}, weight=${structure.weightNote}` +
          (structure.countrySuggestion
            ? `, country=${structure.countrySuggestion.code} (${structure.countrySuggestion.source})`
            : ''),
      );

      return { structure, tokenUsage };
    } catch (err) {
      // callClaudeRaw throws on API errors — catch and fallback gracefully
      this.logger.warn(`Structure analysis failed: ${errMsg(err)}`);
      return { structure: null, tokenUsage: emptyTokenUsageMap() };
    }
  }

  /**
   * Определяет, файл rejected (непригоден) или review (сомнительный, но обрабатываемый).
   * rejected = критические проблемы, которые пользователь может исправить, перезагрузив файл.
   * review = данные есть, но AI не уверен — пусть декларант проверит.
   */
  private assessFeasibility(result: RawParseResult, issues: string[]): Omit<AiParseResult, 'tokenUsage'> {
    const reasons: string[] = [];
    const total = result.products.length;

    if (total === 0) {
      reasons.push('Не удалось извлечь ни одного товара из файла.');
    } else {
      let zeroPriceCount = 0;
      let emptyDescCount = 0;
      let zeroWeightCount = 0;
      for (const p of result.products) {
        if (p.price <= 0) zeroPriceCount++;
        if (!p.description || p.description.trim().length < 3) emptyDescCount++;
        if (!p.weight || p.weight <= 0) zeroWeightCount++;
      }

      if (zeroPriceCount > 0) {
        reasons.push(
          `Не удалось определить цены: у ${zeroPriceCount} из ${total} товаров цена нулевая или не найдена.`,
        );
      }
      if (emptyDescCount > 0) {
        reasons.push(
          `Описания товаров отсутствуют или слишком короткие для классификации по ТН ВЭД (${emptyDescCount} из ${total}).`,
        );
      }
      if (zeroWeightCount > 0) {
        reasons.push(
          `Не указан вес у ${zeroWeightCount} из ${total} товаров. Вес необходим для расчёта пошлин.`,
        );
      }
    }

    if (reasons.length > 0) {
      this.logger.warn(`Document rejected (${total} products): ${reasons.join('; ')}`);
      return { ...result, feasibility: 'rejected', rejectionReasons: reasons, countrySuggestion: null };
    }

    this.logger.log(`Document needs review (${total} products): ${issues.join('; ')}`);
    return { ...result, feasibility: 'review', rejectionReasons: issues, countrySuggestion: null };
  }

  private rejected(reasons: string[]): AiParseResult {
    return {
      products: [],
      currency: '',
      columnMapping: {},
      feasibility: 'rejected',
      rejectionReasons: reasons,
      countrySuggestion: null,
      tokenUsage: emptyTokenUsageMap(),
    };
  }

  private normalizeCountrySuggestion(raw: unknown): CountrySuggestion | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const code = normalizeOksmtCode(typeof obj.code === 'string' ? obj.code : null);
    if (!code) return null;
    const source = obj.source;
    if (source !== 'ai_explicit' && source !== 'ai_language' && source !== 'ai_currency') {
      return null;
    }
    const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
    if (!reason) return null;
    return { code, source, reason };
  }

  private async callClaudeRaw(
    prompt: string,
    sysPrompt = SYSTEM_PROMPT,
    useCache = false,
    tool: Anthropic.Messages.Tool = PARSE_TOOL,
    opts?: { maxTokens?: number; timeout?: number },
  ): Promise<{ raw: unknown; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getParserModel();
    let tokenUsage: TokenUsageMap = emptyTokenUsageMap();
    try {
      const response = await this.anthropic!.messages.create(
        {
          model,
          max_tokens: opts?.maxTokens ?? 16384,
          system: systemPrompt(sysPrompt),
          messages: [{ role: 'user', content: prompt }],
          tools: cacheTools([tool], useCache),
          tool_choice: { type: 'any' },
        },
        { timeout: opts?.timeout ?? 90_000 },
      );
      tokenUsage = tokenUsageFromResponse(model, response.usage);
      return { raw: extractToolInput(response), tokenUsage };
    } catch (err) {
      this.logger.error(`Anthropic API error: ${errMsg(err)}`, err);
      throw new BadRequestException(`Ошибка AI-сервиса: ${errMsg(err)}`);
    }
  }

  private async callClaude(userPrompt: string, useCache = false): Promise<RawParseResult & { tokenUsage: TokenUsageMap }> {
    const { raw, tokenUsage } = await this.callClaudeRaw(userPrompt, SYSTEM_PROMPT, useCache);
    return { ...this.validateSchema(raw), tokenUsage };
  }

  private checkDeterministic(
    result: RawParseResult,
    data: SpreadsheetData,
    expectedProductCount?: number,
  ): string[] {
    const issues: string[] = [];

    const zeroPriceCount = result.products.filter((p) => p.price <= 0).length;
    if (zeroPriceCount > 0) {
      issues.push(
        `${zeroPriceCount} из ${result.products.length} товаров имеют нулевую цену`,
      );
    }

    if (expectedProductCount !== undefined) {
      // Strict check when structure analysis determined exact row count
      if (result.products.length !== expectedProductCount) {
        issues.push(
          `Ожидалось ${expectedProductCount} товаров (по структуре документа), получено ${result.products.length}`,
        );
      }
    } else {
      // Heuristic check when structure is unknown
      const nonEmptyRows = data.rows.filter((row) =>
        row.some((cell) => cell.trim().length > 0),
      ).length;
      const estimatedDataRows = Math.max(1, nonEmptyRows - 2);
      if (result.products.length > estimatedDataRows * 2) {
        issues.push(
          `Слишком много товаров (${result.products.length}) для ${estimatedDataRows} строк данных`,
        );
      }
      if (result.products.length < estimatedDataRows * 0.3 && estimatedDataRows > 5) {
        issues.push(
          `Слишком мало товаров (${result.products.length}) для ${estimatedDataRows} строк данных`,
        );
      }
    }

    return issues;
  }

  private async validateWithAi(
    data: SpreadsheetData,
    result: RawParseResult,
    structure?: DocumentStructure | null,
  ): Promise<ValidationResult & { tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getParserModel();

    let headerRow: string[];
    let sampleSourceRows: string[][];
    let startIdx: number;

    if (structure) {
      headerRow =
        structure.headerRows.length > 0 ? (data.rows[structure.headerRows[0]] ?? []) : [];
      sampleSourceRows = structure.dataRows
        .slice(0, SAMPLE_ROWS)
        .map((i) => data.rows[i])
        .filter(Boolean);
      startIdx = structure.dataRows[0] ?? 0;
    } else {
      headerRow = data.rows[0] ?? [];
      startIdx = Math.min(1, data.rows.length - 1);
      sampleSourceRows = data.rows.slice(startIdx, startIdx + SAMPLE_ROWS);
    }

    const sampleProducts = result.products.slice(0, SAMPLE_ROWS).map(
      ({ hsCode, rawContext, ...core }) => core,
    );

    const sourceTsv = sampleSourceRows
      .map((row, i) => [String(startIdx + i), ...row].join('\t'))
      .join('\n');
    const headerTsv = ['#', ...headerRow].join('\t');

    const mappingInfo = result.columnMapping
      ? `\nМаппинг колонок (0-indexed): ${JSON.stringify(result.columnMapping)}\nИспользуй ТОЛЬКО эти колонки для проверки числовых значений. Остальные колонки — вспомогательные данные, не путай их с ценой или весом.`
      : '';

    const prompt = `Проверь ВЫБОРКУ результата парсинга таблицы с товарами.

Показаны первые ${sampleProducts.length} из ${result.products.length} извлечённых товаров и первые ${sampleSourceRows.length} товарных строк исходной таблицы. Сопоставь по порядку 1-к-1.

<headers>
${headerTsv}
</headers>

<source_rows>
${sourceTsv}
</source_rows>

<parsed_result>
${JSON.stringify({ currency: result.currency, products: sampleProducts }, null, 2)}
</parsed_result>
${mappingInfo}
Проверь ТОЛЬКО показанную выборку:
1. Правильно ли определена валюта? Если в исходных данных есть прямые указания (символ ¥/$€/₽ или слово), а определённая валюта не совпадает — это ошибка. Если валюта определена по контексту (язык, страна) и это разумное предположение — это НЕ ошибка.
2. Корректен ли перевод наименований (смысловой, не транслитерация)?
3. Совпадают ли числа (цена за единицу, общее количество, вес за единицу) с исходными данными? Для проверки бери значения ТОЛЬКО из колонок, указанных в маппинге. Вес должен быть за одну единицу товара, не общий.

Если всё корректно в показанных строках — valid: true, issues: [].
Не включай в issues то, что распознано правильно.`;

    try {
      const response = await this.anthropic!.messages.create(
        {
          model,
          max_tokens: 8192,
          system: systemPrompt(VALIDATION_SYSTEM_PROMPT),
          messages: [{ role: 'user', content: prompt }],
          tools: [VALIDATE_TOOL],
          tool_choice: { type: 'any' },
        },
        { timeout: 90_000 },
      );

      const parsed = extractToolInput<{ valid: boolean; issues: unknown[] }>(response);
      const rawIssues = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];
      const issues = rawIssues.filter((issue) => !this.isFalsePositiveIssue(issue));
      return {
        valid: parsed.valid === true || (rawIssues.length > 0 && issues.length === 0),
        issues,
        tokenUsage: tokenUsageFromResponse(model, response.usage),
      };
    } catch (err) {
      this.logger.warn(`AI validation call failed, treating as unvalidated: ${errMsg(err)}`);
      return { valid: false, issues: ['Сервис валидации недоступен'], tokenUsage: emptyTokenUsageMap() };
    }
  }

  private isFalsePositiveIssue(issue: string): boolean {
    const lower = issue.toLowerCase();
    return (
      VALIDATION_OK_PHRASES.some((phrase) => lower.includes(phrase)) ||
      VALIDATION_OUT_OF_SCOPE_PHRASES.some((phrase) => lower.includes(phrase))
    );
  }

  private formatAsTsv(rows: string[][]): string {
    return rows.map((row, i) => [String(i), ...row].join('\t')).join('\n');
  }

  private enrichRawContext(
    products: ParsedProduct[],
    rows: string[][],
    columnMapping: Record<string, number> | undefined,
  ): ParsedProduct[] {
    if (!columnMapping) return products;
    if (products.length !== rows.length) {
      this.logger.warn(
        `enrichRawContext skipped: ${products.length} products vs ${rows.length} rows`,
      );
      return products;
    }

    const mainCols = new Set<number>();
    for (const key of ['description', 'price', 'weight', 'quantity'] as const) {
      const idx = columnMapping[key];
      if (typeof idx === 'number') mainCols.add(idx);
    }

    return products.map((p, i) => {
      const row = rows[i];
      if (!row) return p;
      const extras: string[] = [];
      for (let c = 0; c < row.length; c++) {
        if (mainCols.has(c)) continue;
        // Cap per-cell length: xlsx may contain embedded images or abnormally large text
        const cell = String(row[c] ?? '').trim().slice(0, MAX_RAW_CONTEXT_CELL_CHARS);
        if (cell) extras.push(cell);
      }
      const rawContext = extras.join('; ');
      return rawContext ? { ...p, rawContext } : p;
    });
  }

  private buildUserPrompt(
    tsv: string,
    structure?: DocumentStructure | null,
    expectedCount?: number,
  ): string {
    let prompt = `Проанализируй таблицу и извлеки данные о товарах.

<spreadsheet_data>
${tsv}
</spreadsheet_data>

Поле dimensions — необязательное. Добавляй только если в таблице есть соответствующие колонки (площадь, объём и т.д.).`;

    if (structure && expectedCount) {
      const weightDesc =
        structure.weightNote === 'per_unit'
          ? 'за единицу товара'
          : structure.weightNote === 'per_box'
            ? 'за коробку (раздели на кол-во штук в коробке для получения веса за единицу)'
            : 'общий вес позиции (раздели на количество для получения веса за единицу)';

      const dataRowsInfo =
        expectedCount <= 50
          ? `Товарные строки: ${structure.dataRows.join(', ')} (ровно ${expectedCount} товаров)`
          : `${expectedCount} товарных строк`;

      prompt += `\n\nВАЖНО — структура документа определена:
- Строки-заголовки: ${structure.headerRows.join(', ')} (НЕ извлекай как товары)
- ${dataRowsInfo}
- Валюта: ${structure.currency}
- Маппинг колонок (0-indexed): наименование=${structure.columnMapping.description}, цена=${structure.columnMapping.price}, вес=${structure.columnMapping.weight}, количество=${structure.columnMapping.quantity}
- Вес в таблице: ${weightDesc}

Извлеки ровно ${expectedCount} товаров — каждая товарная строка = один товар. Не больше и не меньше.`;
    }

    return prompt;
  }

  private buildRetryPrompt(
    tsv: string,
    issues: string[],
    structure?: DocumentStructure | null,
    expectedCount?: number,
  ): string {
    const base = this.buildUserPrompt(tsv, structure, expectedCount);
    const feedback = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
    return `${base}\n\nВНИМАНИЕ: Предыдущая попытка парсинга содержала ошибки:\n${feedback}\n\nИсправь эти ошибки и верни исправленный результат.`;
  }

  private buildChunkPrompt(tsv: string, currency: string, columnMapping: Record<string, number>): string {
    return `Продолжи извлечение товаров из таблицы. Структура и валюта уже определены.

Валюта: ${currency}
Маппинг колонок: ${JSON.stringify(columnMapping)}

<spreadsheet_data>
${tsv}
</spreadsheet_data>

Первая строка — заголовок таблицы (для справки). Извлеки товары из остальных строк.
Правила те же: переведи наименования на русский, пропусти итоги и пустые строки, цена за единицу, вес за единицу в кг.
Поле dimensions — необязательное. Добавляй только если в таблице есть соответствующие колонки.`;
  }

  private async callClaudeChunk(
    tsv: string,
    currency: string,
    columnMapping: Record<string, number>,
  ): Promise<{ products: ParsedProduct[]; tokenUsage: TokenUsageMap }> {
    const prompt = this.buildChunkPrompt(tsv, currency, columnMapping);
    const { raw, tokenUsage } = await this.callClaudeRaw(prompt, CHUNK_SYSTEM_PROMPT, false, PARSE_CHUNK_TOOL);
    const { products } = this.validateSchema(raw);
    return { products, tokenUsage };
  }

  private validateSchema(raw: unknown): RawParseResult {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('AI вернул невалидный ответ');
    }

    const obj = raw as Record<string, unknown>;

    let currency = String(obj.currency ?? '').toUpperCase();
    if (!VALID_CURRENCIES.has(currency)) {
      // Не выбрасываем — assessFeasibility разберётся
      this.logger.warn(`Unknown currency from Claude: ${obj.currency}, defaulting to USD`);
      currency = 'USD';
    }

    const columnMapping = (obj.columnMapping ?? {}) as Record<string, number>;

    if (!Array.isArray(obj.products) || obj.products.length === 0) {
      // Не выбрасываем — assessFeasibility пометит как rejected
      return { products: [], currency, columnMapping };
    }

    const products: ParsedProduct[] = [];
    for (const item of obj.products) {
      const p = item as Record<string, unknown>;
      const description = String(p.description ?? '').trim();
      if (!description) continue;

      const price = Number(p.price);
      const weight = Number(p.weight);
      const quantity = Number(p.quantity);

      if (isNaN(price) || isNaN(quantity)) continue;

      const hsCodeRaw = typeof p.hsCode === 'string' ? p.hsCode.replace(/\D/g, '') : undefined;

      products.push({
        description,
        price: round4(Math.max(0, price)),
        weight: round4(isNaN(weight) ? 0 : Math.max(0, weight)),
        quantity: Math.max(1, quantity),
        ...(hsCodeRaw && hsCodeRaw.length >= 6 ? { hsCode: hsCodeRaw } : {}),
      });
    }

    return { products, currency, columnMapping };
  }
}
