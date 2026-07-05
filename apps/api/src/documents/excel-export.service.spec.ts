import * as ExcelJS from 'exceljs';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import type {
  PhotoStorageService,
  RowPhotoThumbnail,
} from '../photo-storage/photo-storage.service';
import { ExcelExportService } from './excel-export.service';

/** Мок PhotoStorageService: по умолчанию документ без фото. */
function makePhotoStorage(thumbnails: RowPhotoThumbnail[] = []): PhotoStorageService {
  return {
    getRowThumbnails: jest.fn().mockResolvedValue(thumbnails),
  } as unknown as PhotoStorageService;
}

/** Валидный однопиксельный JPEG — ExcelJS не разбирает байты, но пусть будут настоящими. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

function makeThumbnail(overrides: Partial<RowPhotoThumbnail> = {}): RowPhotoThumbnail {
  return {
    rowIndex: 0,
    photoIds: ['photo-1'],
    imageHash: 'hash-1',
    bytes: TINY_JPEG,
    width: 120,
    height: 90,
    ...overrides,
  };
}

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
    service = new ExcelExportService(makePhotoStorage());
  });

  describe('базовая генерация', () => {
    it('создаёт листы "Результат" + "Проект ДТ" + "Документы к поставке" для строк с кодами', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);

      expect(wb.getWorksheet('Результат')).toBeDefined();
      expect(wb.getWorksheet('Проект ДТ')).toBeDefined();
      expect(wb.getWorksheet('Документы к поставке')).toBeDefined();
      expect(wb.worksheets).toHaveLength(3);
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

    it('без weightGross в данных — одна колонка «Вес (кг)», без брутто', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const headers = getHeaders((await readWorkbook(buffer as ArrayBuffer)).getWorksheet('Результат')!);

      expect(headers).toContain('Вес (кг)');
      expect(headers).not.toContain('Вес нетто (кг)');
      expect(headers).not.toContain('Вес брутто (кг)');
    });

    it('при наличии weightGross — колонки «Вес нетто (кг)» и «Вес брутто (кг)»', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ weight: 2, weightGross: 2.4 })],
      });
      const buffer = await service.generate(doc);
      const sheet = (await readWorkbook(buffer as ArrayBuffer)).getWorksheet('Результат')!;
      const headers = getHeaders(sheet);

      expect(headers).toContain('Вес нетто (кг)');
      expect(headers).toContain('Вес брутто (кг)');
      expect(headers).not.toContain('Вес (кг)');
      const grossIdx = headers.indexOf('Вес брутто (кг)') + 1;
      expect(sheet.getRow(2).getCell(grossIdx).value).toBe(2.4);
    });

    it('доп. единица (гр. 41): колонка появляется и показывает количество или нехватку данных', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({ supplementaryUnit: 'пар', supplementaryQuantity: 24 }),
          makeResultRow({ supplementaryUnit: 'л', supplementaryQuantity: null }),
          makeResultRow(),
        ],
      });
      const buffer = await service.generate(doc);
      const sheet = (await readWorkbook(buffer as ArrayBuffer)).getWorksheet('Результат')!;
      const headers = getHeaders(sheet);

      expect(headers).toContain('Доп. единица (гр. 41 ДТ)');
      const colIdx = headers.indexOf('Доп. единица (гр. 41 ДТ)') + 1;
      expect(sheet.getRow(2).getCell(colIdx).value).toBe('24 пар');
      expect(sheet.getRow(3).getCell(colIdx).value).toBe('нет данных (л)');
      expect([null, undefined, '']).toContain(sheet.getRow(4).getCell(colIdx).value);
    });

    it('без supplementaryUnit колонка доп. единицы не добавляется', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const buffer = await service.generate(doc);
      const headers = getHeaders((await readWorkbook(buffer as ArrayBuffer)).getWorksheet('Результат')!);
      expect(headers).not.toContain('Доп. единица (гр. 41 ДТ)');
    });
  });

  describe('лист «Проект ДТ»', () => {
    it('строки одного кода группируются в товар; на основном листе — «№ товара ДТ»', async () => {
      const doc = makeDocument({
        countryOfOrigin: '156',
        exchangeRates: { USD: 90 },
        resultData: [
          makeResultRow({ totalPriceRub: 90000, freightShareRub: 0 }),
          makeResultRow({ description: 'Товар 2', totalPriceRub: 90000, freightShareRub: 0 }),
          makeResultRow({ description: 'Другой код', tnVedCode: '8516101000', totalPriceRub: 45000, freightShareRub: 0 }),
        ],
      });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);

      const main = wb.getWorksheet('Результат')!;
      const mainHeaders = getHeaders(main);
      expect(mainHeaders[0]).toBe('№ товара ДТ');
      expect(main.getRow(2).getCell(1).value).toBe(1);
      expect(main.getRow(3).getCell(1).value).toBe(1);
      expect(main.getRow(4).getCell(1).value).toBe(2);

      const dt = wb.getWorksheet('Проект ДТ')!;
      expect(dt).toBeDefined();
      const dtHeaders = getHeaders(dt);
      expect(dtHeaders).toContain('Код ТН ВЭД (гр. 33)');
      expect(dtHeaders).toContain('Таможенная стоимость (гр. 45), RUB');
      // товар 1: две строки 0201100001
      expect(dt.getRow(2).getCell(2).value).toBe('0201100001');
      expect(dt.getRow(2).getCell(9).value).toBe(180000);
      // страна из документа
      expect(dt.getRow(2).getCell(4).value).toContain('КИТАЙ');
    });

    it('без resultData с кодами лист «Проект ДТ» не создаётся', async () => {
      const doc = makeDocument({ resultData: [makeResultRow({ tnVedCode: '' })] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      expect(wb.getWorksheet('Проект ДТ')).toBeUndefined();
      expect(getHeaders(wb.getWorksheet('Результат')!)).not.toContain('№ товара ДТ');
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

    it('числовые строки с точкой ("6.5") конвертируются в number', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({
            weight: '6.5',
            price: '100.5',
            totalCost: '1430.75',
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const weightIdx = headers.indexOf('Вес (кг)');
      const priceIdx = headers.indexOf('Цена (USD)');
      const totalIdx = headers.indexOf('Итого (USD)');

      expect(typeof sheet.getRow(2).getCell(weightIdx + 1).value).toBe('number');
      expect(sheet.getRow(2).getCell(weightIdx + 1).value).toBe(6.5);
      expect(typeof sheet.getRow(2).getCell(priceIdx + 1).value).toBe('number');
      expect(sheet.getRow(2).getCell(priceIdx + 1).value).toBe(100.5);
      expect(typeof sheet.getRow(2).getCell(totalIdx + 1).value).toBe('number');
      expect(sheet.getRow(2).getCell(totalIdx + 1).value).toBe(1430.75);
    });

    it('числовые строки с запятой ("6,5") конвертируются в number', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow({
            weight: '6,5',
            price: '100,5',
          }),
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const weightIdx = headers.indexOf('Вес (кг)');
      const priceIdx = headers.indexOf('Цена (USD)');

      expect(typeof sheet.getRow(2).getCell(weightIdx + 1).value).toBe('number');
      expect(sheet.getRow(2).getCell(weightIdx + 1).value).toBe(6.5);
      expect(sheet.getRow(2).getCell(priceIdx + 1).value).toBe(100.5);
    });

    it('у колонки "Количество" задан numFmt', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ quantity: 10 })],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const qtyIdx = headers.indexOf('Количество');

      const cell = sheet.getRow(2).getCell(qtyIdx + 1);
      expect(cell.numFmt).toBeTruthy();
    });

    it('все числовые денежные колонки имеют numFmt с десятичной частью', async () => {
      const row = makeResultRow({
        totalPriceRub: 90000,
        dutyAmountRub: 13500,
        vatAmountRub: 20700,
        exciseAmountRub: 0,
        totalCostRub: 128700,
        exchangeRate: 90,
      });
      const doc = makeDocument({ currency: 'USD', resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);

      const moneyHeaders = headers.filter(
        (h) =>
          h.startsWith('Цена ') ||
          h.startsWith('Сумма ') ||
          h.startsWith('Пошлина ') ||
          h.startsWith('НДС ') ||
          h.startsWith('Акциз ') ||
          h.startsWith('Итого '),
      );
      // Каждая денежная колонка должна иметь numFmt
      for (const header of moneyHeaders) {
        const idx = headers.indexOf(header);
        const cell = sheet.getRow(2).getCell(idx + 1);
        expect(cell.numFmt).toBeTruthy();
        expect(typeof cell.value).toBe('number');
      }
    });

    it('пустые/невалидные числовые значения становятся null, не текстом', async () => {
      const row = makeResultRow({ price: 'abc', weight: null });
      const doc = makeDocument({ resultData: [row] });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;
      const headers = getHeaders(sheet);
      const priceIdx = headers.indexOf('Цена (USD)');
      const weightIdx = headers.indexOf('Вес (кг)');

      // null означает пустую ячейку — Excel не воспринимает её как текст
      expect(sheet.getRow(2).getCell(priceIdx + 1).value).toBeNull();
      expect(sheet.getRow(2).getCell(weightIdx + 1).value).toBeNull();
    });
  });

  describe('generateRaw — числовые поля', () => {
    it('конвертирует строковые числа в parsedData в number', async () => {
      const doc = makeDocument({
        resultData: null,
        parsedData: [{ description: 'Товар', price: '100.5', weight: '6,5', quantity: '10' }],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(getRowValues(sheet, 2)).toEqual(['Товар', 100.5, 6.5, 10]);
    });

    it('сохраняет строковые поля с ведущими нулями (например, hsCode)', async () => {
      const doc = makeDocument({
        resultData: null,
        parsedData: [
          { description: 'Товар', hsCode: '0201100001', price: 100, weight: 5, quantity: 1 },
        ],
      });
      const buffer = await service.generate(doc);
      const wb = await readWorkbook(buffer as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(getRowValues(sheet, 2)).toEqual(['Товар', '0201100001', 100, 5, 1]);
    });
  });

  describe('лист «Документы к поставке»', () => {
    function sheetText(sheet: ExcelJS.Worksheet): string {
      const parts: string[] = [];
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => parts.push(String(cell.value ?? '')));
      });
      return parts.join('\n');
    }

    it('лист добавляется при наличии resultData', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const sheet = wb.getWorksheet('Документы к поставке');
      expect(sheet).toBeDefined();
      expect(getHeaders(sheet!)).toEqual([
        'Документ',
        'Код гр. 44',
        'Статус',
        'Строки',
        'Основание',
        'Пояснение',
      ]);
    });

    it('для parsedData без результатов лист не создаётся', async () => {
      const doc = makeDocument({
        resultData: null,
        parsedData: [{ description: 'Товар', price: 100, weight: 5, quantity: 1 }],
      });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      expect(wb.getWorksheet('Документы к поставке')).toBeUndefined();
    });

    it('содержит секции по времени и базовый пакет с кодами гр. 44', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const text = sheetText(wb.getWorksheet('Документы к поставке')!);

      expect(text).toContain('До заказа / производства');
      expect(text).toContain('К отгрузке');
      expect(text).toContain('На случай запроса таможни');
      expect(text).toContain('Внешнеторговый контракт');
      expect(text).toContain('03011');
      expect(text).toContain('04021');
      expect(text).toContain('Прайс-лист производителя');
      expect(text).toContain('Экспортная таможенная декларация');
      expect(text).toContain('информационный характер');
    });

    it('меры строк попадают в чек-лист с номерами строк', async () => {
      const doc = makeDocument({
        resultData: [
          makeResultRow(),
          makeResultRow({
            regulatoryReport: {
              certifications: [
                {
                  id: 'r1',
                  category: 'certification',
                  priznak: 11,
                  title: 'Сертификация',
                  summary: '',
                  regulation: 'ТР ТС 004/2011',
                  regulationTitle: null,
                  form: 'certificate',
                  authority: null,
                  documentRef: null,
                  validFrom: null,
                  validTo: null,
                  matchPrecision: 'exact',
                  codeRange: { min: '85', max: null },
                  countryCode: null,
                  countryName: null,
                  values: { min: null, max: null, unit: null },
                  rawNote: '',
                },
              ],
              permits: [],
              licenses: [],
              marking: [],
              traceability: [],
              utilizationFee: [],
              strategicAndDualUse: [],
              countryRestrictions: [],
              other: [],
              totalCount: 1,
            },
          }),
        ],
      });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const sheet = wb.getWorksheet('Документы к поставке')!;
      const text = sheetText(sheet);

      expect(text).toContain('Сертификат соответствия ТР ТС 004/2011');
      expect(text).toContain('01401');
      // Пункт относится ко второй строке листа «Результат».
      const rowWithCert = [...Array(sheet.rowCount).keys()]
        .map((i) => sheet.getRow(i + 1))
        .find((r) => String(r.getCell(1).value ?? '').includes('ТР ТС 004/2011'));
      expect(rowWithCert!.getCell(4).value).toBe('2');
    });

    it('при language=zh добавляется локализованная колонка', async () => {
      const doc = makeDocument({ language: 'zh', resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const headers = getHeaders(wb.getWorksheet('Документы к поставке')!);
      expect(headers).toContain('文件（翻译）');
      expect(sheetText(wb.getWorksheet('Документы к поставке')!)).toContain('商业发票');
    });

    it('маркировка «Честный знак» по коду обуви даёт curated-пункт с датой волны', async () => {
      const doc = makeDocument({
        resultData: [makeResultRow({ tnVedCode: '6403911100' })],
      });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const text = sheetText(wb.getWorksheet('Документы к поставке')!);
      expect(text).toContain('Маркировка «Честный знак» — Обувь');
      expect(text).toContain('01.07.2020');
    });
  });

  describe('фото строк', () => {
    it('без фото колонки «Фото» нет', async () => {
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      expect(getHeaders(wb.getWorksheet('Результат')!)).not.toContain('Фото');
    });

    it('с фото появляется колонка «Фото» и картинка на листе', async () => {
      service = new ExcelExportService(makePhotoStorage([makeThumbnail()]));
      const doc = makeDocument({ resultData: [makeResultRow(), makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      const headers = getHeaders(sheet);
      expect(headers[1]).toBe('Наименование');
      expect(headers[2]).toBe('Фото');
      expect(sheet.getImages()).toHaveLength(1);
      // Якорь на строке первого товара (row zero-based: заголовок 0, товар 1)
      expect(Math.floor(sheet.getImages()[0].range.tl.row)).toBe(1);
    });

    it('одинаковые изображения (hash) регистрируются в workbook один раз', async () => {
      service = new ExcelExportService(
        makePhotoStorage([
          makeThumbnail({ rowIndex: 0, photoIds: ['p1'], imageHash: 'same' }),
          makeThumbnail({ rowIndex: 1, photoIds: ['p2'], imageHash: 'same' }),
        ]),
      );
      const doc = makeDocument({ resultData: [makeResultRow(), makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      // Обе строки ссылаются на одно media (imageId одинаковый)
      const images = sheet.getImages();
      expect(images).toHaveLength(2);
      expect(images[0].imageId).toBe(images[1].imageId);
    });

    it('строка с фото получает высоту под миниатюру', async () => {
      service = new ExcelExportService(
        makePhotoStorage([makeThumbnail({ height: 120 })]),
      );
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      const sheet = wb.getWorksheet('Результат')!;

      expect(sheet.getRow(2).height).toBeGreaterThanOrEqual(90);
    });

    it('сбой загрузки фото не роняет генерацию — Excel без колонки «Фото»', async () => {
      service = new ExcelExportService({
        getRowThumbnails: jest.fn().mockRejectedValue(new Error('db down')),
      } as unknown as PhotoStorageService);
      const doc = makeDocument({ resultData: [makeResultRow()] });
      const wb = await readWorkbook((await service.generate(doc)) as ArrayBuffer);
      expect(getHeaders(wb.getWorksheet('Результат')!)).not.toContain('Фото');
    });
  });
});
