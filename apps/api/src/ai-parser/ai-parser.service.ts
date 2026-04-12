import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { extractClaudeText, parseClaudeJson } from '../common/claude';
import { type TokenUsageMap, emptyTokenUsageMap, mergeTokenUsage, tokenUsageFromResponse } from '../common/token-usage';
import type { Dimension } from '../duty-interpreter/interfaces';
import { SpreadsheetData, SpreadsheetReaderService } from './spreadsheet-reader.service';

export interface ParsedProduct {
  description: string;
  price: number;
  weight: number;
  quantity: number;
  dimensions?: Dimension[];
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

const MAX_ROWS = 400;
const CHUNK_SIZE = 100;
const SAMPLE_ROWS = 5;
const MAX_ATTEMPTS = 2;

/** Порог для assessFeasibility: отклонять если >80% товаров имеют нулевую цену */
const REJECT_ZERO_PRICE_RATIO = 0.8;
/** Порог: отклонять если >80% описаний пустые или < 3 символов */
const REJECT_EMPTY_DESC_RATIO = 0.8;

const SYSTEM_PROMPT = `Ты — эксперт по парсингу коммерческих документов для импорта товаров.

Твоя задача — проанализировать таблицу с данными о товарах и извлечь структурированную информацию.

Правила:
1. Определи валюту цен по символам (¥/$/€/₽) или по контексту (китайские товары = CNY, если не указано иное)
2. Найди колонки с наименованиями товаров, ценами за единицу, весом и количеством
3. Если наименования не на русском — переведи на русский. Транслитерация НЕ допускается, нужен смысловой перевод
4. Если количество вычисляется из нескольких колонок (например, коробки × штук/коробку) — используй итоговое количество
5. Вес должен быть общим весом позиции в килограммах (не за единицу). Если в таблице только вес за единицу — умножь на количество
6. Цена должна быть за одну единицу товара в исходной валюте
7. Пропусти итоговые/суммарные строки (ИТОГО, 合计, Total и т.п.)
8. Пропусти пустые строки и строки без наименования товара
9. Пропусти строки-заголовки и подзаголовки
10. Если таблица содержит несколько строк заголовков (например, на двух языках) — используй их для понимания структуры, но не включай в результат
11. Если в таблице есть дополнительные числовые характеристики товара (площадь, объём, длина, объём м3 и т.д.) — извлеки их в массив dimensions с единицами измерения

Отвечай ТОЛЬКО валидным JSON в указанном формате. Никакого текста до или после JSON.`;

const VALIDATION_SYSTEM_PROMPT = `Ты — валидатор результатов парсинга коммерческих документов.

Тебе предоставлены исходные строки таблицы и результат их парсинга. Проверь корректность.

Отвечай ТОЛЬКО валидным JSON. Никакого текста до или после JSON.`;

const CHUNK_SYSTEM_PROMPT = `Ты — эксперт по парсингу коммерческих документов для импорта товаров. Продолжай извлечение данных согласно указанным правилам. Отвечай ТОЛЬКО валидным JSON.`;

@Injectable()
export class AiParserService {
  private logger = new Logger(AiParserService.name);

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private spreadsheetReader: SpreadsheetReaderService,
    private aiConfig: AiConfigService,
  ) {}

  async parse(buffer: Buffer, fileName: string): Promise<AiParseResult> {
    if (!this.anthropic) {
      throw new BadRequestException('AI-парсер недоступен: ANTHROPIC_API_KEY не настроен');
    }

    const data = await this.spreadsheetReader.read(buffer, fileName, MAX_ROWS + 1);

    if (data.rows.length > MAX_ROWS) {
      return this.rejected([
        `Файл содержит слишком много строк (более ${MAX_ROWS}). Пожалуйста, разделите файл на части не более ${MAX_ROWS} строк.`,
      ]);
    }

    if (data.rows.length < 2) {
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

      const { tokenUsage, ...result } = await this.callClaude(prompt);
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

    // Remaining chunks: simplified parsing with known structure
    let failedChunks = 0;
    for (let c = 1; c < chunks.length; c++) {
      const chunkWithHeader = [headerRow, ...chunks[c]];
      const chunkTsv = this.formatAsTsv(chunkWithHeader);

      try {
        const { products, tokenUsage } = await this.callClaudeChunk(chunkTsv, currency, columnMapping);
        totalUsage = mergeTokenUsage(totalUsage, tokenUsage);
        allProducts.push(...products);
        this.logger.log(`Chunk ${c}: parsed ${products.length} products`);
      } catch (err) {
        failedChunks++;
        this.logger.error(`Chunk ${c} parsing failed`, err);
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

      if (zeroPriceCount > total * REJECT_ZERO_PRICE_RATIO) {
        reasons.push(
          `Не удалось определить цены: у ${zeroPriceCount} из ${total} товаров цена нулевая или не найдена.`,
        );
      }
      if (emptyDescCount > total * REJECT_EMPTY_DESC_RATIO) {
        reasons.push(
          'Описания товаров отсутствуют или слишком короткие для классификации по ТН ВЭД.',
        );
      }
      if (zeroWeightCount === total) {
        reasons.push('Не указан вес ни для одного товара.');
      }
    }

    if (reasons.length > 0) {
      this.logger.warn(`Document rejected: ${reasons.join('; ')}`);
      return { ...result, feasibility: 'rejected', rejectionReasons: reasons };
    }

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
    systemPrompt = SYSTEM_PROMPT,
  ): Promise<{ raw: unknown; tokenUsage: TokenUsageMap }> {
    const model = await this.aiConfig.getParserModel();
    let text: string;
    let tokenUsage: TokenUsageMap = emptyTokenUsageMap();
    try {
      const response = await this.anthropic!.messages.create(
        { model, max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: prompt }] },
        { timeout: 45_000 },
      );
      tokenUsage = tokenUsageFromResponse(model, response.usage);
      text = extractClaudeText(response);
    } catch (err) {
      this.logger.error('Anthropic API error', err);
      throw new BadRequestException('Ошибка AI-сервиса. Попробуйте позже.');
    }
    return { raw: this.parseJson(text), tokenUsage };
  }

  private async callClaude(userPrompt: string): Promise<RawParseResult & { tokenUsage: TokenUsageMap }> {
    const { raw, tokenUsage } = await this.callClaudeRaw(userPrompt);
    return { ...this.validateSchema(raw), tokenUsage };
  }

  private checkDeterministic(result: RawParseResult, data: SpreadsheetData): string[] {
    const issues: string[] = [];

    // All prices should be > 0
    const zeroPriceCount = result.products.filter((p) => p.price <= 0).length;
    if (zeroPriceCount > result.products.length * 0.5) {
      issues.push(
        `Больше половины товаров (${zeroPriceCount}/${result.products.length}) имеют нулевую цену`,
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
    const sampleProducts = result.products.slice(0, SAMPLE_ROWS);

    const sourceTsv = sampleSourceRows
      .map((row, i) => [String(startIdx + i), ...row].join('\t'))
      .join('\n');

    const prompt = `Проверь результат парсинга таблицы с товарами.

<source_rows>
${sourceTsv}
</source_rows>

<parsed_result>
${JSON.stringify({ currency: result.currency, products: sampleProducts }, null, 2)}
</parsed_result>

Проверь:
1. Правильно ли определена валюта?
2. Корректен ли перевод наименований (смысловой, не транслитерация)?
3. Совпадают ли числа (цена за единицу, общее количество, общий вес) с исходными данными?
4. Нет ли пропущенных или лишних строк?

Ответь JSON:
{
  "valid": true или false,
  "issues": ["описание проблемы 1", "..."]
}

Если всё корректно — {"valid": true, "issues": []}`;

    try {
      const response = await this.anthropic!.messages.create(
        { model, max_tokens: 1024, system: VALIDATION_SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] },
        { timeout: 15_000 },
      );

      const text = extractClaudeText(response);

      const parsed = this.parseJson(text) as Record<string, unknown>;
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

Ответь JSON в формате:
{
  "currency": "ISO 4217 код валюты (CNY, USD, EUR, RUB и т.д.)",
  "columnMapping": {
    "description": номер_колонки_начиная_с_0,
    "price": номер_колонки_начиная_с_0,
    "weight": номер_колонки_начиная_с_0,
    "quantity": номер_колонки_начиная_с_0
  },
  "products": [
    {
      "description": "наименование на русском",
      "price": цена_за_единицу_число,
      "weight": общий_вес_позиции_в_кг_число,
      "quantity": общее_количество_число,
      "dimensions": [{"name": "area", "value": число, "unit": "m2"}]
    }
  ]
}

Поле dimensions — необязательное. Добавляй только если в таблице есть соответствующие колонки (площадь, объём и т.д.).`;
  }

  private buildRetryPrompt(tsv: string, issues: string[]): string {
    const base = this.buildUserPrompt(tsv);
    const feedback = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
    return `${base}\n\nВНИМАНИЕ: Предыдущая попытка парсинга содержала ошибки:\n${feedback}\n\nИсправь эти ошибки.`;
  }

  private buildChunkPrompt(tsv: string, currency: string, columnMapping: Record<string, number>): string {
    return `Продолжи извлечение товаров из таблицы. Структура и валюта уже определены.

Валюта: ${currency}
Маппинг колонок: ${JSON.stringify(columnMapping)}

<spreadsheet_data>
${tsv}
</spreadsheet_data>

Первая строка — заголовок таблицы (для справки). Извлеки товары из остальных строк.
Правила те же: переведи наименования на русский, пропусти итоги и пустые строки, цена за единицу, вес общий в кг.

Ответь ТОЛЬКО валидным JSON:
{
  "products": [
    {
      "description": "наименование на русском",
      "price": цена_за_единицу,
      "weight": общий_вес_в_кг,
      "quantity": количество,
      "dimensions": [{"name": "area", "value": число, "unit": "m2"}]
    }
  ]
}

Поле dimensions — необязательное. Добавляй только если в таблице есть соответствующие колонки.`;
  }

  private async callClaudeChunk(
    tsv: string,
    currency: string,
    columnMapping: Record<string, number>,
  ): Promise<{ products: ParsedProduct[]; tokenUsage: TokenUsageMap }> {
    const prompt = this.buildChunkPrompt(tsv, currency, columnMapping);
    const { raw, tokenUsage } = await this.callClaudeRaw(prompt, CHUNK_SYSTEM_PROMPT);
    const { products } = this.validateSchema(raw);
    return { products, tokenUsage };
  }

  private parseJson(text: string): unknown {
    try {
      return parseClaudeJson(text);
    } catch {
      throw new BadRequestException('AI вернул невалидный JSON');
    }
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

      products.push({
        description,
        price: Math.max(0, price),
        weight: isNaN(weight) ? 0 : Math.max(0, weight),
        quantity: Math.max(1, quantity),
      });
    }

    return { products, currency, columnMapping };
  }
}
