import * as ExcelJS from 'exceljs';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { ExcelExportService } from './excel-export.service';

function makeDocument(overrides: Partial<Document> = {}): Document {
  const doc = new Document();
  Object.assign(doc, {
    id: 'doc-1',
    telegramUserId: null,
    uploadedByUserId: null,
    originalFileName: 'test.xlsx',
    status: DocumentStatus.PROCESSED,
    currency: 'USD',
    exchangeRates: null,
    language: null,
    countryOfOrigin: null,
    countryOriginSource: null,
    countryDetectionReason: null,
    columnMapping: null,
    parsedData: null,
    resultData: null,
    rowCount: 0,
    errorMessage: null,
    rejectionReasons: null,
    tokenUsage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    telegramUser: null,
    uploadedBy: null,
    fileBuffer: null,
    ...overrides,
  });
  return doc;
}

function makeResultRow(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Товар',
    quantity: 10,
    price: 100,
    weight: 2,
    tnVedCode: '0201100001',
    tnVedDescription: 'Мясо КРС',
    dutyRate: 15,
    vatRate: 20,
    exciseRate: 0,
    totalPrice: 1000,
    dutyAmount: 150,
    vatAmount: 230,
    exciseAmount: 0,
    logisticsCommission: 50,
    totalCost: 1430,
    verificationStatus: 'exact',
    calculationStatus: 'exact',
    matchConfidence: 0.9,
    ...overrides,
  };
}

async function readWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

function getHeaders(sheet: ExcelJS.Worksheet): string[] {
  const row = sheet.getRow(1);
  const headers: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? ''));
  });
  return headers;
}

function getRowValues(sheet: ExcelJS.Worksheet, rowIdx: number): unknown[] {
  const row = sheet.getRow(rowIdx);
  const values: unknown[] = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    values.push(cell.value);
  });
  return values;
}

describe('ExcelExportService', () => {
  let service: ExcelExportService;

  beforeEach(() => {
    service = new ExcelExportService();
  });

  describe('базовая генерация', () => {
    it('создаёт workbook с одним листом "Результат"', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);

      const sheet = wb.getWorksheet('Результат');
      expect(sheet).toBeDefined();
      expect(wb.worksheets).toHaveLength(1);
    });

    it('creator = DirectPort', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);

      expect(wb.creator).toBe('DirectPort');
    });

    it('количество строк соответствует размеру resultData + 1 (заголовок)', async () => {
      const rows = [makeResultRow(), makeResultRow(), makeResultRow()];
      const doc = makeDocument({ resultData: rows });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(sheet.rowCount).toBe(4);
    });
  });

  describe('заголовки и валюта', () => {
    it('подставляет валюту документа в заголовки', async () => {
      const doc = makeDocument({ currency: 'EUR', resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers).toContain('Цена (EUR)');
      expect(headers).toContain('Сумма (EUR)');
      expect(headers).toContain('Пошлина (EUR)');
      expect(headers).toContain('Итого (EUR)');
    });

    it('USD по умолчанию если currency отсутствует', async () => {
      const doc = makeDocument({ currency: null, resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers).toContain('Цена (USD)');
    });

    it('при currency=RUB нет колонки курса и дополнительных RUB-конвертаций', async () => {
      const doc = makeDocument({ currency: 'RUB', resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      // Сами колонки валюты остаются с (RUB), но доп. курса и дубль-колонок нет
      expect(headers.some((h) => h.startsWith('Курс'))).toBe(false);
      // Только один "Итого (RUB)", а не два
      expect(headers.filter((h) => h === 'Итого (RUB)')).toHaveLength(1);
    });

    it('добавляет RUB-колонки при currency!=RUB и наличии totalCostRub', async () => {
      const row = makeResultRow({
        totalPriceRub: 90000,
        dutyAmountRub: 13500,
        vatAmountRub: 20700,
        exciseAmountRub: 0,
        logisticsCommissionRub: 4500,
        totalCostRub: 128700,
        exchangeRate: 90,
      });
      const doc = makeDocument({ currency: 'USD', resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers).toContain('Сумма (RUB)');
      expect(headers).toContain('Пошлина (RUB)');
      expect(headers).toContain('НДС (RUB)');
      expect(headers).toContain('Итого (RUB)');
      expect(headers).toContain('Курс USD/RUB');
    });

    it('не добавляет RUB-колонки если в row нет totalCostRub', async () => {
      const doc = makeDocument({ currency: 'EUR', resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers.some((h) => h.includes('(RUB)'))).toBe(false);
    });
  });

  describe('локализованные заметки', () => {
    it('добавляет колонку "Notes (translated)" при language=en', async () => {
      const doc = makeDocument({
        language: 'en',
        resultData: [
          makeResultRow({
            notes: [
              {
                stage: 'classify',
                severity: 'warning',
                field: 'code',
                message: 'Код найден с оговорками',
                messageLocalized: 'Code found with caveats',
              },
            ],
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers).toContain('Notes (translated)');
    });

    it('добавляет колонку "备注（翻译）" при language=zh', async () => {
      const doc = makeDocument({
        language: 'zh',
        resultData: [makeResultRow({ notes: [] })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers).toContain('备注（翻译）');
    });

    it('не добавляет локализованную колонку для language=ru', async () => {
      const doc = makeDocument({ language: 'ru', resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Результат')!);

      expect(headers.some((h) => h.includes('translated') || h.includes('翻译'))).toBe(false);
    });

    it('локализованная колонка содержит messageLocalized', async () => {
      const doc = makeDocument({
        language: 'en',
        resultData: [
          makeResultRow({
            notes: [
              {
                stage: 'classify',
                severity: 'warning',
                message: 'Код найден с оговорками',
                messageLocalized: 'Code found with caveats',
              },
            ],
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const localizedIdx = headers.indexOf('Notes (translated)');

      const cell = sheet.getRow(2).getCell(localizedIdx + 1);
      expect(String(cell.value)).toContain('Code found with caveats');
    });
  });

  describe('форматирование статусов', () => {
    it('calculationStatus=exact → метка "Точное"', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ calculationStatus: 'exact' })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Точное');
    });

    it('calculationStatus=partial → метка "Есть замечания"', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ calculationStatus: 'partial' })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Есть замечания');
    });

    it('calculationStatus=needs_info → метка "Требует уточнения"', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ calculationStatus: 'needs_info' })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Требует уточнения');
    });

    it('calculationStatus=error → метка "Ошибка"', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ calculationStatus: 'error' })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Ошибка');
    });

    it('обратная совместимость: verificationStatus=exact без calculationStatus → exact', async () => {
      const row = makeResultRow({ verificationStatus: 'exact' });
      delete (row as any).calculationStatus;
      const doc = makeDocument({ resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Точное');
    });

    it('обратная совместимость: verificationStatus=review → partial', async () => {
      const row = makeResultRow({ verificationStatus: 'review' });
      delete (row as any).calculationStatus;
      const doc = makeDocument({ resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');

      expect(sheet.getRow(2).getCell(statusIdx + 1).value).toBe('Есть замечания');
    });

    it('статус-cell имеет цветовую заливку', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ calculationStatus: 'exact' })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const statusIdx = headers.indexOf('Статус');
      const cell = sheet.getRow(2).getCell(statusIdx + 1);

      expect((cell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      // Зелёный для exact
      expect((cell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC6EFCE');
    });
  });

  describe('форматирование замечаний', () => {
    it('сортирует по severity: blocker > warning > info', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({
            notes: [
              { stage: 'classify', severity: 'info', message: 'инфо-заметка' },
              { stage: 'calculate', severity: 'blocker', message: 'блокер-заметка' },
              { stage: 'verify', severity: 'warning', message: 'предупреждение' },
            ],
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const notesIdx = headers.indexOf('Замечания');

      const notesText = String(sheet.getRow(2).getCell(notesIdx + 1).value);
      const lines = notesText.split('\n');
      expect(lines[0]).toContain('блокер-заметка');
      expect(lines[1]).toContain('предупреждение');
      expect(lines[2]).toContain('инфо-заметка');
    });

    it('префиксы: blocker=⚠, warning=!, info=•', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({
            notes: [
              { stage: 'classify', severity: 'blocker', message: 'B' },
              { stage: 'verify', severity: 'warning', message: 'W' },
              { stage: 'calculate', severity: 'info', message: 'I' },
            ],
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const notesIdx = headers.indexOf('Замечания');
      const notesText = String(sheet.getRow(2).getCell(notesIdx + 1).value);

      expect(notesText).toMatch(/⚠\s*B/);
      expect(notesText).toMatch(/!\s*W/);
      expect(notesText).toMatch(/•\s*I/);
    });

    it('локализованная колонка использует messageLocalized с fallback на message', async () => {
      const doc = makeDocument({
        language: 'en',
        resultData: [
          makeResultRow({
            notes: [
              {
                stage: 'classify',
                severity: 'warning',
                message: 'Русский текст',
                messageLocalized: 'English text',
              },
              // Без messageLocalized — fallback на message
              { stage: 'verify', severity: 'info', message: 'Без перевода' },
            ],
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const localizedIdx = headers.indexOf('Notes (translated)');
      const text = String(sheet.getRow(2).getCell(localizedIdx + 1).value);

      expect(text).toContain('English text');
      expect(text).toContain('Без перевода');
      expect(text).not.toContain('Русский текст');
    });

    it('пустые notes → пустая ячейка', async () => {
      const doc = makeDocument({ resultData: [makeResultRow({ notes: [] })] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const notesIdx = headers.indexOf('Замечания');

      const cell = sheet.getRow(2).getCell(notesIdx + 1);
      expect(cell.value ?? '').toBe('');
    });
  });

  describe('fallback для отсутствующих полей', () => {
    it('tnVedCode пустой → "—"', async () => {
      const doc = makeDocument({ resultData: [makeResultRow({ tnVedCode: '' })] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const codeIdx = headers.indexOf('Код ТН ВЭД');

      expect(sheet.getRow(2).getCell(codeIdx + 1).value).toBe('—');
    });

    it('без dutyRateDisplay — fallback на "N%"', async () => {
      const row = makeResultRow({ dutyRate: 15 });
      delete (row as any).dutyRateDisplay;
      const doc = makeDocument({ resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const rateIdx = headers.indexOf('Ставка пошлины');

      expect(sheet.getRow(2).getCell(rateIdx + 1).value).toBe('15%');
    });

    it('dutyRateDisplay используется если задан', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({ dutyRateDisplay: '15% но не менее 0.5 EUR/кг' }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const rateIdx = headers.indexOf('Ставка пошлины');

      expect(sheet.getRow(2).getCell(rateIdx + 1).value).toBe('15% но не менее 0.5 EUR/кг');
    });
  });

  describe('структура листа', () => {
    it('включает autoFilter по всему диапазону', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow(), makeResultRow(), makeResultRow()],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(sheet.autoFilter).toBeDefined();
    });

    it('первая строка заморожена (frozen header)', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      const view = sheet.views?.[0] as { state?: string; ySplit?: number } | undefined;
      expect(view?.state).toBe('frozen');
      expect(view?.ySplit).toBe(1);
    });

    it('заголовок имеет синюю заливку и белый текст', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headerCell = sheet.getRow(1).getCell(1);

      expect((headerCell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF4472C4');
      expect(headerCell.font?.color?.argb).toBe('FFFFFFFF');
      expect(headerCell.font?.bold).toBe(true);
    });
  });

  describe('generateRaw (без resultData)', () => {
    it('для parsedData без resultData генерирует сырой лист с заголовками из ключей', async () => {
      const doc = makeDocument({
        resultData: null,
        parsedData: [
          { description: 'Товар A', price: 100, weight: 5 },
          { description: 'Товар B', price: 200, weight: 10 },
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(getRowValues(sheet, 1)).toEqual(['description', 'price', 'weight']);
      expect(getRowValues(sheet, 2)).toEqual(['Товар A', 100, 5]);
      expect(getRowValues(sheet, 3)).toEqual(['Товар B', 200, 10]);
    });

    it('пустой документ → workbook без строк', async () => {
      const doc = makeDocument({ resultData: null, parsedData: [] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(sheet.rowCount).toBe(0);
    });
  });

  describe('численные поля', () => {
    it('сохраняет числовые значения как числа, не строки', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({
            quantity: 10,
            price: 100.5,
            totalCost: 1430.75,
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const priceIdx = headers.indexOf('Цена (USD)');
      const qtyIdx = headers.indexOf('Количество');

      expect(typeof sheet.getRow(2).getCell(priceIdx + 1).value).toBe('number');
      expect(sheet.getRow(2).getCell(priceIdx + 1).value).toBe(100.5);
      expect(sheet.getRow(2).getCell(qtyIdx + 1).value).toBe(10);
    });
  });
});
