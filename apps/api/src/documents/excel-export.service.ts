import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Document } from '../database/entities/document.entity';

interface ResultRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
  totalPrice: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
  verificationStatus: 'exact' | 'review';
}

function buildColumns(currency: string) {
  const columns: { header: string; key: keyof ResultRow; width: number; numFmt?: string }[] = [
    { header: 'Наименование', key: 'description', width: 40 },
    { header: 'Количество', key: 'quantity', width: 12 },
    { header: `Цена (${currency})`, key: 'price', width: 14, numFmt: '#,##0.00' },
    { header: 'Вес (кг)', key: 'weight', width: 12, numFmt: '#,##0.00' },
    { header: 'Код ТН ВЭД', key: 'tnVedCode', width: 16 },
    { header: 'Описание ТН ВЭД', key: 'tnVedDescription', width: 35 },
    { header: 'Ставка пошлины (%)', key: 'dutyRate', width: 18, numFmt: '0.00' },
    { header: 'Ставка НДС (%)', key: 'vatRate', width: 16, numFmt: '0.00' },
    { header: `Сумма товара (${currency})`, key: 'totalPrice', width: 18, numFmt: '#,##0.00' },
    { header: `Пошлина (${currency})`, key: 'dutyAmount', width: 16, numFmt: '#,##0.00' },
    { header: `НДС (${currency})`, key: 'vatAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Акциз (${currency})`, key: 'exciseAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Комиссия (${currency})`, key: 'logisticsCommission', width: 18, numFmt: '#,##0.00' },
    { header: `Итого (${currency})`, key: 'totalCost', width: 18, numFmt: '#,##0.00' },
    { header: 'Статус проверки', key: 'verificationStatus', width: 18 },
  ];
  return columns;
}

const GREEN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC6EFCE' },
};

const YELLOW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFEB9C' },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

@Injectable()
export class ExcelExportService {
  async generate(doc: Document): Promise<ExcelJS.Buffer> {
    const data = (doc.resultData ?? doc.parsedData ?? []) as unknown as ResultRow[];
    const hasResults = data.length > 0 && 'tnVedCode' in data[0];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DirectPort';
    const sheet = workbook.addWorksheet('Результат');

    if (!hasResults) {
      return this.generateRaw(workbook, data as unknown as Record<string, unknown>[]);
    }

    const COLUMNS = buildColumns(doc.currency || 'USD');

    // Column definitions
    sheet.columns = COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    // Header style
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 30;

    // Precompute columns with number formats
    const numFmtColumns = COLUMNS
      .map((col, i) => ({ index: i + 1, numFmt: col.numFmt }))
      .filter((c) => c.numFmt);

    // Data rows
    for (const row of data) {
      const excelRow = sheet.addRow({
        description: row.description,
        quantity: row.quantity,
        price: row.price,
        weight: row.weight,
        tnVedCode: row.tnVedCode || '—',
        tnVedDescription: row.tnVedDescription || '—',
        dutyRate: row.dutyRate,
        vatRate: row.vatRate,
        totalPrice: row.totalPrice,
        dutyAmount: row.dutyAmount,
        vatAmount: row.vatAmount,
        exciseAmount: row.exciseAmount,
        logisticsCommission: row.logisticsCommission,
        totalCost: row.totalCost,
        verificationStatus: row.verificationStatus === 'exact' ? 'Точное' : 'Ручная проверка',
      });

      for (const col of numFmtColumns) {
        excelRow.getCell(col.index).numFmt = col.numFmt!;
      }

      // Status cell color
      const statusCell = excelRow.getCell(COLUMNS.length);
      statusCell.fill = row.verificationStatus === 'exact' ? GREEN_FILL : YELLOW_FILL;
      statusCell.font = {
        bold: true,
        color: { argb: row.verificationStatus === 'exact' ? 'FF006100' : 'FF9C5700' },
      };
    }

    // Autofilter
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.length + 1, column: COLUMNS.length },
    };

    // Freeze header
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    return workbook.xlsx.writeBuffer();
  }

  private async generateRaw(workbook: ExcelJS.Workbook, data: Record<string, unknown>[]): Promise<ExcelJS.Buffer> {
    const sheet = workbook.getWorksheet('Результат')!;
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      sheet.addRow(headers);
      for (const row of data) {
        sheet.addRow(headers.map((h) => row[h]));
      }
    }
    return workbook.xlsx.writeBuffer();
  }
}
