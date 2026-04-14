import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { extractToolInput, systemPrompt } from '../common/claude';
import { errMsg } from '../common/errors';
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

export interface AiParseResult {
  products: ParsedProduct[];
  currency: string;
  columnMapping: Record<string, number>;
  /** 'ok' — уверенный результат, 'review' — сомнительный, 'rejected' — данные непригодны */
  feasibility: ParseFeasibility;
  /** Причины отклонения (при rejected) или замечания (при review). Пустой для ok. */
  rejectionReasons: string[];
  tokenUsage: TokenUsageMap;
}

type RawParseResult = Omit<AiParseResult, 'feasibility' | 'rejectionReasons' | 'tokenUsage'>;

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
15. Для каждого товара собери ВСЕ оставшиеся данные строки в поле rawContext: материал, состав, назначение, технические характеристики, артикул, бренд, упаковка — всё что не вошло в description, price, weight, quantity. Объедини через "; ". Если дополнительных данных нет — не включай поле

`;

const VALIDATION_SYSTEM_PROMPT = `Ты — валидатор результатов парсинга коммерческих документов для импорта товаров в Россию.

Тебе предоставлены исходные строки таблицы и результат их парсинга. Проверь корректность.

КРИТИЧЕСКИ ВАЖНО: issues должен содержать ТОЛЬКО реальные ошибки. Если значение в parsed_result совпадает с исходными данными (после пересчёта) — это НЕ ошибка, НЕ включай.

Правила:
- Ошибка — это когда число в parsed_result НЕ совпадает с исходным (после пересчёта на единицу товара).
- Если в файле указан общий вес, а в результате — вес единицы (= общий / количество) — это ПРАВИЛЬНО, не issue.
- Если в файле указана общая цена, а в результате — цена единицы (= общая / количество) — это ПРАВИЛЬНО, не issue.
- НЕ пиши "проверьте" или "возможно" для корректных значений. Если ты вычислил что значение верно — пропусти его.
- НЕ сообщай о корректно распознанных данных — только о реальных расхождениях.
- НЕ упоминай пропущенные итоговые строки (ИТОГО, 合计, Total) — они пропускаются намеренно.
- НЕ упоминай отсутствующие поля (артикул, номер, габариты) — они не требуются.
- НЕ проверяй поля hsCode и rawContext — они информационные.
- Каждый issue — одно предложение с конкретным расхождением (ожидаемое значение vs фактическое).
- Если всё верно — обязательно верни valid: true, issues: [].

`;

const CHUNK_SYSTEM_PROMPT = `Ты — эксперт по парсингу коммерческих документов для импорта товаров. Продолжай извлечение данных согласно указанным правилам.`;

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
    rawContext: {
      type: 'string',
      description: 'ВСЕ остальные данные строки через "; " (материал, назначение, характеристики, артикул, бренд и т.д.). НЕ включай description/price/weight/quantity. Пропусти если доп. данных нет',
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
      valid: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
    },
    required: ['valid', 'issues'],
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

    if (data.rows.length <= CHUNK_SIZE) {
      return this.parseSinglePass(data);
    }

    return this.parseChunked(data);
  }

  private async parseSinglePass(data: SpreadsheetData): Promise<AiParseResult> {
    const tsv = this.formatAsTsv(data.rows);
    let lastResult: RawParseResult | null = null;
    let lastIssues: string[] = [];
    let totalUsage = emptyTokenUsageMap();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const userPrompt =
        attempt === 1 ? this.buildUserPrompt(tsv) : this.buildRetryPrompt(tsv, lastIssues);

      const { tokenUsage, ...result } = await this.callClaude(userPrompt);
      totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
      lastResult = result;

      const detIssues = this.checkDeterministic(result, data);
      if (detIssues.length > 0) {
        this.logger.warn(`Attempt ${attempt}: deterministic issues: ${detIssues.join('; ')}`);
        lastIssues = detIssues;
        if (attempt < MAX_ATTEMPTS) continue;
        return { ...this.assessFeasibility(result, lastIssues), tokenUsage: totalUsage };
      }

      const { tokenUsage: valUsage, ...validation } = await this.validateWithAi(data, result);
      totalUsage = mergeTokenUsage(totalUsage, valUsage);
      if (validation.valid) {
        this.logger.log(
          `Parsed ${result.products.length} products, currency=${result.currency} (attempt ${attempt})`,
        );
        return { ...result, feasibility: 'ok', rejectionReasons: [], tokenUsage: totalUsage };
      }

      this.logger.warn(`Attempt ${attempt}: AI validation issues: ${validation.issues.join('; ')}`);
      lastIssues = validation.issues;
    }

    this.logger.warn(
      `Returning result after ${MAX_ATTEMPTS} attempts with issues (${lastIssues.join('; ')})`,
    );
    return { ...this.assessFeasibility(lastResult!, lastIssues), tokenUsage: totalUsage };
  }

  private async parseChunked(data: SpreadsheetData): Promise<AiParseResult> {
    let totalUsage = emptyTokenUsageMap();
    const headerRow = data.rows[0];

    const chunks: string[][][] = [];
    for (let i = 0; i < data.rows.length; i += CHUNK_SIZE) {
      chunks.push(data.rows.slice(i, Math.min(i + CHUNK_SIZE, data.rows.length)));
    }

    this.logger.log(`Parsing ${data.rows.length} rows in ${chunks.length} chunks`);

    // First chunk: full analysis with retry
    const firstTsv = this.formatAsTsv(chunks[0]);
    let firstResult: RawParseResult | null = null;
    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const prompt = attempt === 1
        ? this.buildUserPrompt(firstTsv)
        : this.buildRetryPrompt(firstTsv, lastIssues);

      const { tokenUsage, ...result } = await this.callClaude(prompt, true);
      totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
      firstResult = result;

      const issues = this.checkDeterministic(result, { rows: chunks[0], columnCount: data.columnCount });
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

    // Remaining chunks: simplified parsing with known structure (concurrency=2)
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
          allProducts.push(...r.products);
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

    // AI validation on full result
    const { tokenUsage: valUsage, ...validation } = await this.validateWithAi(data, fullResult);
    totalUsage = mergeTokenUsage(totalUsage, valUsage);
    if (!validation.valid) {
      issues.push(...validation.issues);
    }

    if (issues.length > 0) {
      this.logger.warn(`Chunked parse issues: ${issues.join('; ')}`);
      return { ...this.assessFeasibility(fullResult, issues), tokenUsage: totalUsage };
    }

    this.logger.log(`Parsed ${allProducts.length} products in ${chunks.length} chunks, currency=${currency}`);
    return { ...fullResult, feasibility: 'ok', rejectionReasons: [], tokenUsage: totalUsage };
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
      return { ...result, feasibility: 'rejected', rejectionReasons: reasons };
    }

    this.logger.log(`Document needs review (${total} products): ${issues.join('; ')}`);
    return { ...result, feasibility: 'review', rejectionReasons: issues };
  }

  private rejected(reasons: string[]): AiParseResult {
    return {
      products: [],
      currency: '',
      columnMapping: {},
      feasibility: 'rejected',
      rejectionReasons: reasons,
      tokenUsage: emptyTokenUsageMap(),
    };
  }

  private async callClaudeRaw(
    prompt: string,
    sysPrompt = SYSTEM_PROMPT,
    useCache = false,
    tool: Anthropic.Messages.Tool = PARSE_TOOL,
  ): Promise<{ raw: unknown; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getParserModel();
    let tokenUsage: TokenUsageMap = emptyTokenUsageMap();
    try {
      const system = systemPrompt(sysPrompt, useCache);
      const response = await this.anthropic!.messages.create(
        {
          model,
          max_tokens: 8192,
          system,
          messages: [{ role: 'user', content: prompt }],
          tools: [tool],
          tool_choice: { type: 'any' },
        },
        { timeout: 90_000 },
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

  private checkDeterministic(result: RawParseResult, data: SpreadsheetData): string[] {
    const issues: string[] = [];

    // All prices should be > 0
    const zeroPriceCount = result.products.filter((p) => p.price <= 0).length;
    if (zeroPriceCount > 0) {
      issues.push(
        `${zeroPriceCount} из ${result.products.length} товаров имеют нулевую цену`,
      );
    }

    // Row count sanity: parsed products should be within ±50% of non-empty data rows
    const nonEmptyRows = data.rows.filter((row) =>
      row.some((cell) => cell.trim().length > 0),
    ).length;
    // Subtract ~2 header rows estimate
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

    return issues;
  }

  private async validateWithAi(
    data: SpreadsheetData,
    result: RawParseResult,
  ): Promise<ValidationResult & { tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getParserModel();
    // Pick sample rows from start of data (skip first row as header)
    const startIdx = Math.min(1, data.rows.length - 1);
    const sampleSourceRows = data.rows.slice(startIdx, startIdx + SAMPLE_ROWS);
    const sampleProducts = result.products.slice(0, SAMPLE_ROWS).map(
      ({ hsCode, rawContext, ...core }) => core,
    );

    const headerRow = data.rows[0] ?? [];
    const sourceTsv = sampleSourceRows
      .map((row, i) => [String(startIdx + i), ...row].join('\t'))
      .join('\n');
    const headerTsv = ['#', ...headerRow].join('\t');

    const mappingInfo = result.columnMapping
      ? `\nМаппинг колонок (0-indexed): ${JSON.stringify(result.columnMapping)}\nИспользуй ТОЛЬКО эти колонки для проверки числовых значений. Остальные колонки — вспомогательные данные, не путай их с ценой или весом.`
      : '';

    const prompt = `Проверь результат парсинга таблицы с товарами.

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
Проверь:
1. Правильно ли определена валюта? Если в исходных данных есть прямые указания (символ ¥/$€/₽ или слово), а определённая валюта не совпадает — это ошибка. Если валюта определена по контексту (язык, страна) и это разумное предположение — это НЕ ошибка.
2. Корректен ли перевод наименований (смысловой, не транслитерация)?
3. Совпадают ли числа (цена за единицу, общее количество, вес за единицу) с исходными данными? Для проверки бери значения ТОЛЬКО из колонок, указанных в маппинге. Вес должен быть за одну единицу товара, не общий.
4. Нет ли пропущенных товарных строк? Итоговые строки (ИТОГО, Total, 合计) НЕ считаются пропущенными.

Если всё корректно — valid: true, issues: [].
Не включай в issues то, что распознано правильно.`;

    try {
      const response = await this.anthropic!.messages.create(
        {
          model,
          max_tokens: 1024,
          system: systemPrompt(VALIDATION_SYSTEM_PROMPT),
          messages: [{ role: 'user', content: prompt }],
          tools: [VALIDATE_TOOL],
          tool_choice: { type: 'any' },
        },
        { timeout: 15_000 },
      );

      const parsed = extractToolInput<{ valid: boolean; issues: unknown[] }>(response);
      return {
        valid: parsed.valid === true,
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
        tokenUsage: tokenUsageFromResponse(model, response.usage),
      };
    } catch (err) {
      this.logger.warn('AI validation call failed, treating as unvalidated', err);
      return { valid: false, issues: ['Сервис валидации недоступен'], tokenUsage: emptyTokenUsageMap() };
    }
  }

  private formatAsTsv(rows: string[][]): string {
    return rows.map((row, i) => [String(i), ...row].join('\t')).join('\n');
  }

  private buildUserPrompt(tsv: string): string {
    return `Проанализируй таблицу и извлеки данные о товарах.

<spreadsheet_data>
${tsv}
</spreadsheet_data>

Поле dimensions — необязательное. Добавляй только если в таблице есть соответствующие колонки (площадь, объём и т.д.).`;
  }

  private buildRetryPrompt(tsv: string, issues: string[]): string {
    const base = this.buildUserPrompt(tsv);
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
      const rawContext = typeof p.rawContext === 'string' ? p.rawContext.trim() : undefined;

      products.push({
        description,
        price: round4(Math.max(0, price)),
        weight: round4(isNaN(weight) ? 0 : Math.max(0, weight)),
        quantity: Math.max(1, quantity),
        ...(hsCodeRaw && hsCodeRaw.length >= 6 ? { hsCode: hsCodeRaw } : {}),
        ...(rawContext ? { rawContext } : {}),
      });
    }

    return { products, currency, columnMapping };
  }
}
