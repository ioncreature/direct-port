import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface ProductRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
}

@Injectable()
export class ExcelService {
  private logger = new Logger(ExcelService.name);

  async parse(buffer: Buffer): Promise<ProductRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Файл не содержит листов');

    const rows: ProductRow[] = [];
    const headerRow = sheet.getRow(1);
    const headers = this.extractHeaders(headerRow);

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const description = String(row.getCell(headers.description).value || '').trim();
      if (!description) return;

      rows.push({
        description,
        quantity: Number(row.getCell(headers.quantity).value) || 1,
        price: Number(row.getCell(headers.price).value) || 0,
        weight: Number(row.getCell(headers.weight).value) || 0,
      });
    });

    this.logger.log(`Parsed ${rows.length} product rows`);
    return rows;
  }

  private extractHeaders(row: ExcelJS.Row): Record<string, number> {
    const map: Record<string, number> = {
      description: 1,
      quantity: 2,
      price: 3,
      weight: 4,
    };

    row.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').toLowerCase().trim();
      if (val.includes('описан') || val.includes('наименован') || val.includes('товар') || val === 'description') {
        map.description = colNumber;
      } else if (val.includes('кол') || val.includes('количеств') || val === 'quantity' || val === 'qty') {
        map.quantity = colNumber;
      } else if (val.includes('цен') || val.includes('стоимост') || val === 'price') {
        map.price = colNumber;
      } else if (val.includes('вес') || val.includes('масс') || val === 'weight') {
        map.weight = colNumber;
      }
    });

    return map;
  }
}
