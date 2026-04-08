import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SpreadsheetReaderService, SpreadsheetData } from './spreadsheet-reader.service';
import type { Dimension } from '../duty-interpreter/interfaces';

export interface ParsedProduct {
  description: string;
  price: number;
  weight: number;
  quantity: number;
  dimensions?: Dimension[];
  [key: string]: unknown;
}

export interface AiParseResult {
  products: ParsedProduct[];
  currency: string;
  columnMapping: Record<string, number>;
  confident: boolean;
}

type RawParseResult = Omit<AiParseResult, 'confident'>;

interface ValidationResult {
  valid: boolean;
  issues: string[];
}

const VALID_CURRENCIES = new Set([
  'CNY', 'USD', 'EUR', 'RUB', 'GBP', 'JPY', 'KRW', 'TRY', 'AED',
  'THB', 'VND', 'INR', 'BRL', 'KZT', 'BYN', 'UAH', 'UZS', 'GEL',
]);

const MAX_ROWS = 200;
const SAMPLE_ROWS = 5;
const MAX_ATTEMPTS = 2;

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

@Injectable()
export class AiParserService {
  private logger = new Logger(AiParserService.name);

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private spreadsheetReader: SpreadsheetReaderService,
  ) {}

  async parse(buffer: Buffer, fileName: string): Promise<AiParseResult> {
    if (!this.anthropic) {
      throw new BadRequestException(
        'AI-парсер недоступен: ANTHROPIC_API_KEY не настроен',
      );
    }

    const data = await this.spreadsheetReader.read(buffer, fileName);
    if (data.rows.length < 2) {
      throw new BadRequestException('Файл не содержит данных');
    }

    const tsv = this.formatAsTsv(data);
    let lastResult: RawParseResult | null = null;
    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const userPrompt = attempt === 1
        ? this.buildUserPrompt(tsv)
        : this.buildRetryPrompt(tsv, lastIssues);

      const result = await this.callClaude(userPrompt);
      lastResult = result;

      // Deterministic checks
      const detIssues = this.checkDeterministic(result, data);
      if (detIssues.length > 0) {
        this.logger.warn(`Attempt ${attempt}: deterministic issues: ${detIssues.join('; ')}`);
        lastIssues = detIssues;
        if (attempt < MAX_ATTEMPTS) continue;
        return { ...result, confident: false };
      }

      // AI validation
      const validation = await this.validateWithAi(data, result);
      if (validation.valid) {
        this.logger.log(
          `Parsed ${result.products.length} products, currency=${result.currency} (attempt ${attempt}, confident)`,
        );
        return { ...result, confident: true };
      }

      this.logger.warn(`Attempt ${attempt}: AI validation issues: ${validation.issues.join('; ')}`);
      lastIssues = validation.issues;
    }

    this.logger.warn(
      `Returning result after ${MAX_ATTEMPTS} attempts with low confidence (${lastIssues.join('; ')})`,
    );
    return { ...lastResult!, confident: false };
  }

  private async callClaude(userPrompt: string): Promise<RawParseResult> {
    let text: string;
    try {
      const response = await this.anthropic!.messages.create(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        },
        { timeout: 45_000 },
      );

      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } catch (err) {
      this.logger.error('Anthropic API error', err);
      throw new BadRequestException('Ошибка AI-сервиса. Попробуйте позже.');
    }

    const parsed = this.parseJson(text);
    return this.validateSchema(parsed);
  }

  private checkDeterministic(result: RawParseResult, data: SpreadsheetData): string[] {
    const issues: string[] = [];

    // All prices should be > 0
    const zeroPriceCount = result.products.filter((p) => p.price <= 0).length;
    if (zeroPriceCount > result.products.length * 0.5) {
      issues.push(`Больше половины товаров (${zeroPriceCount}/${result.products.length}) имеют нулевую цену`);
    }

    // Row count sanity: parsed products should be within ±50% of non-empty data rows
    const nonEmptyRows = data.rows.filter((row) =>
      row.some((cell) => cell.trim().length > 0),
    ).length;
    // Subtract ~2 header rows estimate
    const estimatedDataRows = Math.max(1, nonEmptyRows - 2);
    if (result.products.length > estimatedDataRows * 2) {
      issues.push(`Слишком много товаров (${result.products.length}) для ${estimatedDataRows} строк данных`);
    }
    if (result.products.length < estimatedDataRows * 0.3 && estimatedDataRows > 5) {
      issues.push(`Слишком мало товаров (${result.products.length}) для ${estimatedDataRows} строк данных`);
    }

    return issues;
  }

  private async validateWithAi(
    data: SpreadsheetData,
    result: RawParseResult,
  ): Promise<ValidationResult> {
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
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: VALIDATION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: 15_000 },
      );

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const parsed = this.parseJson(text) as Record<string, unknown>;
      return {
        valid: parsed.valid === true,
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      };
    } catch (err) {
      this.logger.warn('AI validation call failed, treating as unvalidated', err);
      return { valid: false, issues: ['Сервис валидации недоступен'] };
    }
  }

  private formatAsTsv(data: SpreadsheetData): string {
    const lines: string[] = [];
    const limit = Math.min(data.rows.length, MAX_ROWS);
    for (let i = 0; i < limit; i++) {
      lines.push([String(i), ...data.rows[i]].join('\t'));
    }
    return lines.join('\n');
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

  private parseJson(text: string): unknown {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new BadRequestException('AI вернул невалидный JSON');
    }
  }

  private validateSchema(raw: unknown): RawParseResult {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('AI вернул невалидный ответ');
    }

    const obj = raw as Record<string, unknown>;

    const currency = String(obj.currency ?? '').toUpperCase();
    if (!VALID_CURRENCIES.has(currency)) {
      throw new BadRequestException(`Неизвестная валюта: ${obj.currency}`);
    }

    const columnMapping = (obj.columnMapping ?? {}) as Record<string, number>;

    if (!Array.isArray(obj.products) || obj.products.length === 0) {
      throw new BadRequestException('AI не нашёл товаров в файле');
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

    if (products.length === 0) {
      throw new BadRequestException('AI не нашёл валидных товаров в файле');
    }

    return { products, currency, columnMapping };
  }
}
