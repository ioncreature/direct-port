import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SpreadsheetReaderService, SpreadsheetData } from './spreadsheet-reader.service';

export interface ParsedProduct {
  description: string;
  price: number;
  weight: number;
  quantity: number;
  [key: string]: unknown;
}

export interface AiParseResult {
  products: ParsedProduct[];
  currency: string;
  columnMapping: Record<string, number>;
}

const VALID_CURRENCIES = new Set([
  'CNY', 'USD', 'EUR', 'RUB', 'GBP', 'JPY', 'KRW', 'TRY', 'AED',
  'THB', 'VND', 'INR', 'BRL', 'KZT', 'BYN', 'UAH', 'UZS', 'GEL',
]);

const MAX_ROWS = 200;

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

Отвечай ТОЛЬКО валидным JSON в указанном формате. Никакого текста до или после JSON.`;

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
    const userPrompt = this.buildUserPrompt(tsv);

    let text: string;
    try {
      const response = await this.anthropic.messages.create(
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
    const result = this.validate(parsed);

    this.logger.log(
      `Parsed ${result.products.length} products, currency=${result.currency}`,
    );
    return result;
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
      "quantity": общее_количество_число
    }
  ]
}`;
  }

  private parseJson(text: string): unknown {
    // Strip markdown code block if present
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

  private validate(raw: unknown): AiParseResult {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('AI вернул невалидный ответ');
    }

    const obj = raw as Record<string, unknown>;

    // Currency
    const currency = String(obj.currency ?? '').toUpperCase();
    if (!VALID_CURRENCIES.has(currency)) {
      throw new BadRequestException(`Неизвестная валюта: ${obj.currency}`);
    }

    // Column mapping
    const columnMapping = (obj.columnMapping ?? {}) as Record<string, number>;

    // Products
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
