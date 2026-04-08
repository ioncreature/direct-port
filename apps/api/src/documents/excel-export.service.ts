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
  totalPriceRub?: number;
  dutyAmountRub?: number;
  vatAmountRub?: number;
  exciseAmountRub?: number;
  logisticsCommissionRub?: number;
  totalCostRub?: number;
  exchangeRate?: number;
  verificationStatus: 'exact' | 'review';
}

interface ColumnDef {
  header: string;
  key: keyof ResultRow;
  width: number;
  numFmt?: string;
}

function buildColumns(currency: string, hasRub: boolean): ColumnDef[] {
  const columns: ColumnDef[] = [
    { header: 'Наименование', key: 'description', width: 40 },
    { header: 'Количество', key: 'quantity', width: 12 },
    { header: `Цена (${currency})`, key: 'price', width: 14, numFmt: '#,##0.00' },
    { header: 'Вес (кг)', key: 'weight', width: 12, numFmt: '#,##0.00' },
    { header: 'Код ТН ВЭД', key: 'tnVedCode', width: 16 },
    { header: 'Описание ТН ВЭД', key: 'tnVedDescription', width: 35 },
    { header: 'Ставка пошлины (%)', key: 'dutyRate', width: 18, numFmt: '0.00' },
    { header: 'Ставка НДС (%)', key: 'vatRate', width: 16, numFmt: '0.00' },
    { header: `Сумма (${currency})`, key: 'totalPrice', width: 16, numFmt: '#,##0.00' },
    { header: `Пошлина (${currency})`, key: 'dutyAmount', width: 16, numFmt: '#,##0.00' },
    { header: `НДС (${currency})`, key: 'vatAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Акциз (${currency})`, key: 'exciseAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Комиссия (${currency})`, key: 'logisticsCommission', width: 16, numFmt: '#,##0.00' },
    { header: `Итого (${currency})`, key: 'totalCost', width: 16, numFmt: '#,##0.00' },
  ];

  if (hasRub) {
    columns.push(
      { header: 'Сумма (RUB)', key: 'totalPriceRub', width: 16, numFmt: '#,##0.00' },
      { header: 'Пошлина (RUB)', key: 'dutyAmountRub', width: 16, numFmt: '#,##0.00' },
      { header: 'НДС (RUB)', key: 'vatAmountRub', width: 14, numFmt: '#,##0.00' },
      { header: 'Акциз (RUB)', key: 'exciseAmountRub', width: 14, numFmt: '#,##0.00' },
      { header: 'Комиссия (RUB)', key: 'logisticsCommissionRub', width: 16, numFmt: '#,##0.00' },
      { header: 'Итого (RUB)', key: 'totalCostRub', width: 16, numFmt: '#,##0.00' },
      { header: `Курс ${currency}/RUB`, key: 'exchangeRate', width: 14, numFmt: '0.0000' },
    );
  }

  columns.push({ header: 'Статус проверки', key: 'verificationStatus', width: 18 });
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

    const currency = doc.currency || 'USD';
    const hasRub = currency !== 'RUB' && data.length > 0 && 'totalCostRub' in data[0];
    const COLUMNS = buildColumns(currency, hasRub);

    sheet.columns = COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 30;

    const numFmtColumns = COLUMNS
      .map((col, i) => ({ index: i + 1, numFmt: col.numFmt }))
      .filter((c) => c.numFmt);

    for (const row of data) {
      const rowData: Record<string, unknown> = {
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
      };

      if (hasRub) {
        rowData.totalPriceRub = row.totalPriceRub;
        rowData.dutyAmountRub = row.dutyAmountRub;
        rowData.vatAmountRub = row.vatAmountRub;
        rowData.exciseAmountRub = row.exciseAmountRub;
        rowData.logisticsCommissionRub = row.logisticsCommissionRub;
        rowData.totalCostRub = row.totalCostRub;
        rowData.exchangeRate = row.exchangeRate;
      }

      const excelRow = sheet.addRow(rowData);

      for (const col of numFmtColumns) {
        excelRow.getCell(col.index).numFmt = col.numFmt!;
      }

      const statusCell = excelRow.getCell(COLUMNS.length);
      statusCell.fill = row.verificationStatus === 'exact' ? GREEN_FILL : YELLOW_FILL;
      statusCell.font = {
        bold: true,
        color: { argb: row.verificationStatus === 'exact' ? 'FF006100' : 'FF9C5700' },
      };
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.length + 1, column: COLUMNS.length },
    };

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
