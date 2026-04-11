import { Injectable, Logger } from '@nestjs/common';
import { parse as csvParseSync } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';

export interface ProductRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
}

export interface ColumnMappingInput {
  description: number;
  price: number;
  weight: number;
  quantity: number;
}

@Injectable()
export class ExcelService {
  private logger = new Logger(ExcelService.name);

  async getFileHeaders(buffer: Buffer, fileType: 'xlsx' | 'csv'): Promise<string[]> {
    if (fileType === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return [];
      const headerRow = sheet.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value || '').trim();
      });
      return headers.filter((h) => h.length > 0);
    }

    // CSV
    const text = buffer.toString('utf-8');
    const firstLine = text.split(/\r?\n/)[0];
    const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
    return firstLine.split(delimiter).map((h) => h.trim().replace(/^"(.*)"$/, '$1'));
  }

  async parseWithMapping(
    buffer: Buffer,
    fileType: 'xlsx' | 'csv',
    mapping: ColumnMappingInput,
  ): Promise<ProductRow[]> {
    if (fileType === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return [];

      const rows: ProductRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const description = String(row.getCell(mapping.description + 1).value || '').trim();
        if (!description) return;
        rows.push({
          description,
          quantity: Number(row.getCell(mapping.quantity + 1).value) || 1,
          price: Number(row.getCell(mapping.price + 1).value) || 0,
          weight: Number(row.getCell(mapping.weight + 1).value) || 0,
        });
      });

      this.logger.log(`Parsed ${rows.length} rows with mapping`);
      return rows;
    }

    // CSV
    const records = csvParseSync(buffer.toString('utf-8'), {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter: [',', ';', '\t'],
    }) as string[][];

    const dataRows = records.slice(1);
    const rows = dataRows
      .filter((row) => (row[mapping.description] || '').trim())
      .map((row) => ({
        description: (row[mapping.description] || '').trim(),
        quantity: Number(row[mapping.quantity]) || 1,
        price: Number(row[mapping.price]) || 0,
        weight: Number(row[mapping.weight]) || 0,
      }));

    this.logger.log(`Parsed ${rows.length} CSV rows with mapping`);
    return rows;
  }
}
