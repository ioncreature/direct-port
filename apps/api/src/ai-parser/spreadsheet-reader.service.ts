import { Injectable, Logger } from '@nestjs/common';
import { parse as csvParseSync } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';

export interface SpreadsheetData {
  rows: string[][];
  columnCount: number;
}

function extractCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'richText' in value) {
    return (value.richText as Array<{ text: string }>)
      .map((rt) => rt.text)
      .join('')
      .trim();
  }
  if (typeof value === 'object' && 'result' in value) {
    return extractCellValue(value.result as ExcelJS.CellValue);
  }
  if (typeof value === 'object' && 'error' in value) return '';
  return String(value);
}

@Injectable()
export class SpreadsheetReaderService {
  private logger = new Logger(SpreadsheetReaderService.name);

  async read(buffer: Buffer, fileName: string, maxRows = 200): Promise<SpreadsheetData> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'csv') return this.readCsv(buffer, maxRows);
    return this.readXlsx(buffer, maxRows);
  }

  private async readXlsx(buffer: Buffer, maxRows: number): Promise<SpreadsheetData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { rows: [], columnCount: 0 };

    const rows: string[][] = [];
    let columnCount = 0;

    sheet.eachRow((row) => {
      if (rows.length >= maxRows) return;
      const cells: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        cells.push(extractCellValue(row.getCell(c).value));
      }
      rows.push(cells);
      columnCount = Math.max(columnCount, cells.length);
    });

    this.logger.log(`Read XLSX: ${rows.length} rows, ${columnCount} columns`);
    return { rows, columnCount };
  }

  private readCsv(buffer: Buffer, maxRows: number): SpreadsheetData {
    const records = csvParseSync(buffer.toString('utf-8'), {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter: [',', ';', '\t'],
      to: maxRows,
    }) as string[][];

    const columnCount = records.reduce((max, row) => Math.max(max, row.length), 0);
    const rows = records.map((row) => row.map((cell) => (cell ?? '').trim()));

    this.logger.log(`Read CSV: ${rows.length} rows, ${columnCount} columns`);
    return { rows, columnCount };
  }
}
