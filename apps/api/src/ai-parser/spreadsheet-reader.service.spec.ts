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
