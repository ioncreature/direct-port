import { SpreadsheetReaderService } from './spreadsheet-reader.service';
import * as ExcelJS from 'exceljs';

describe('SpreadsheetReaderService', () => {
  let service: SpreadsheetReaderService;

  beforeEach(() => {
    service = new SpreadsheetReaderService();
  });

  describe('CSV', () => {
    it('читает CSV с запятой-разделителем', async () => {
      const csv = 'Name,Price,Weight\nWidget,100,2.5\nGadget,200,3.0';
      const result = await service.read(Buffer.from(csv), 'test.csv');

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toEqual(['Name', 'Price', 'Weight']);
      expect(result.rows[1]).toEqual(['Widget', '100', '2.5']);
      expect(result.columnCount).toBe(3);
    });

    it('читает CSV с точкой-с-запятой', async () => {
      const csv = 'Name;Price;Weight\nWidget;100;2.5';
      const result = await service.read(Buffer.from(csv), 'data.csv');

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['Name', 'Price', 'Weight']);
    });

    it('читает CSV с табуляцией', async () => {
      const csv = 'Name\tPrice\tWeight\nWidget\t100\t2.5';
      const result = await service.read(Buffer.from(csv), 'data.csv');

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['Name', 'Price', 'Weight']);
    });

    it('обрезает пробелы в ячейках', async () => {
      const csv = ' Name , Price \n Widget , 100 ';
      const result = await service.read(Buffer.from(csv), 'test.csv');

      expect(result.rows[0]).toEqual(['Name', 'Price']);
      expect(result.rows[1]).toEqual(['Widget', '100']);
    });

    it('ограничивает количество строк maxRows', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `row${i},val${i}`);
      const csv = lines.join('\n');
      const result = await service.read(Buffer.from(csv), 'test.csv', 5);

      expect(result.rows).toHaveLength(5);
    });

    it('обрабатывает пустой CSV', async () => {
      const result = await service.read(Buffer.from(''), 'test.csv');
      expect(result.rows).toHaveLength(0);
      expect(result.columnCount).toBe(0);
    });
  });

  describe('XLSX', () => {
    async function makeXlsxBuffer(data: (string | number)[][]): Promise<Buffer> {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      for (const row of data) {
        sheet.addRow(row);
      }
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer);
    }

    it('читает простой XLSX', async () => {
      const buffer = await makeXlsxBuffer([
        ['Name', 'Price', 'Weight'],
        ['Widget', 100, 2.5],
        ['Gadget', 200, 3.0],
      ]);

      const result = await service.read(buffer, 'test.xlsx');
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toEqual(['Name', 'Price', 'Weight']);
      expect(result.rows[1]).toEqual(['Widget', '100', '2.5']);
      expect(result.columnCount).toBe(3);
    });

    it('ограничивает количество строк maxRows', async () => {
      const data = Array.from({ length: 20 }, (_, i) => [`row${i}`, i]);
      const buffer = await makeXlsxBuffer(data);

      const result = await service.read(buffer, 'test.xlsx', 5);
      expect(result.rows).toHaveLength(5);
    });

    it('пустой лист → пустой результат', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Sheet1');
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await service.read(buffer, 'test.xlsx');
      expect(result.rows).toHaveLength(0);
      expect(result.columnCount).toBe(0);
    });

    it('несколько листов с данными: обрабатывается первый, остальные попадают в skippedSheets', async () => {
      const workbook = new ExcelJS.Workbook();
      const s1 = workbook.addWorksheet('Товары');
      s1.addRow(['Name', 'Price']);
      s1.addRow(['Widget', 100]);
      const s2 = workbook.addWorksheet('Ещё товары');
      s2.addRow(['Name', 'Price']);
      s2.addRow(['Gadget', 200]);
      s2.addRow(['Gizmo', 300]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.read(buffer, 'test.xlsx');
      expect(result.sheetName).toBe('Товары');
      expect(result.rows).toHaveLength(2);
      expect(result.skippedSheets).toEqual([{ name: 'Ещё товары', rows: 3 }]);
    });

    it('пустой первый лист пропускается — данные берутся с первого непустого', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Титульный');
      const s2 = workbook.addWorksheet('Данные');
      s2.addRow(['Name', 'Price']);
      s2.addRow(['Widget', 100]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.read(buffer, 'test.xlsx');
      expect(result.sheetName).toBe('Данные');
      expect(result.rows).toHaveLength(2);
      expect(result.skippedSheets).toBeUndefined();
    });

    it('лист из одной строки не считается пропущенными данными (титульник)', async () => {
      const workbook = new ExcelJS.Workbook();
      const s1 = workbook.addWorksheet('Товары');
      s1.addRow(['Name', 'Price']);
      s1.addRow(['Widget', 100]);
      const s2 = workbook.addWorksheet('Note');
      s2.addRow(['Спасибо за заказ!']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.read(buffer, 'test.xlsx');
      expect(result.skippedSheets).toBeUndefined();
    });
  });

  describe('Защита от zip-бомбы', () => {
    // Собираем минимальный ZIP: local-заглушка (для ZIP-сигнатуры) + одна запись
    // центрального каталога с ЗАЯВЛЕННЫМ распакованным размером + EOCD. Данные не
    // распаковываются — проверка читает только каталог.
    function makeZip(uncompressedSize: number, entries = 1): Buffer {
      const name = Buffer.from('a');
      const cd = Buffer.alloc(46 + name.length);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt32LE(0, 20); // compressed size
      cd.writeUInt32LE(uncompressedSize >>> 0, 24); // uncompressed size
      cd.writeUInt16LE(name.length, 28);
      name.copy(cd, 46);
      const local = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // PK\x03\x04 + пэддинг
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entries, 8);
      eocd.writeUInt16LE(entries, 10);
      eocd.writeUInt32LE(cd.length, 12);
      eocd.writeUInt32LE(local.length, 16); // смещение начала центрального каталога
      return Buffer.concat([local, cd, eocd]);
    }

    it('заявленный распакованный размер сверх бюджета → отклоняется', async () => {
      const bomb = makeZip(300 * 1024 * 1024); // 300 МБ > 200 МБ бюджета
      await expect(service.read(bomb, 'bomb.xlsx')).rejects.toThrow();
    });

    it('слишком много записей в архиве → отклоняется', async () => {
      const many = makeZip(1, 10_001);
      await expect(service.read(many, 'many.xlsx')).rejects.toThrow();
    });

    it('легитимный xlsx с умеренным содержимым проходит проверку', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['Name', 'Price']);
      sheet.addRow(['Widget', 100]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      // Не бросает на bomb-проверке (дальше — штатный парсинг).
      await expect(service.read(buffer, 'ok.xlsx')).resolves.toBeDefined();
    });
  });

  describe('Определение формата по расширению', () => {
    it('.csv → CSV-парсер', async () => {
      const csv = 'a,b\n1,2';
      const result = await service.read(Buffer.from(csv), 'data.CSV');
      // CSV successfully parsed → no throw
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('.xlsx → XLSX-парсер (не CSV)', async () => {
      // Если передать CSV-контент с расширением .xlsx → ExcelJS бросит ошибку
      await expect(service.read(Buffer.from('a,b\n1,2'), 'test.xlsx')).rejects.toThrow();
    });
  });
});
