import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { normalizePer } from '../calculator/calculator.service';
import type { CalculationStatus, ProductNote } from '../common/product-notes';
import { Document } from '../database/entities/document.entity';
import type { Dimension } from '../duty-interpreter/interfaces';
import type { RegulatoryReport } from '../regulatory/interfaces';
import { formatRegulatoryReportLong } from '../regulatory/regulatory-format';

interface ResultRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  dimensions?: Dimension[] | null;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  dutyRateDisplay?: string;
  vatRate: number;
  exciseRate: number;
  totalPrice: number;
  freightShare?: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
  totalPriceRub?: number;
  freightShareRub?: number;
  dutyAmountRub?: number;
  vatAmountRub?: number;
  exciseAmountRub?: number;
  logisticsCommissionRub?: number;
  totalCostRub?: number;
  exchangeRate?: number;
  /** Устаревшее поле, оставлено для совместимости со старыми resultData. */
  verificationStatus: 'exact' | 'review';
  /** Новое: агрегированный статус расчёта */
  calculationStatus?: CalculationStatus;
  dutyAmountIsEstimate?: boolean;
  notes?: ProductNote[];
  regulatoryReport?: RegulatoryReport | null;
}

/** Находит объём за единицу товара (в литрах) среди dimensions строки.
 *  Возвращает null, если в dimensions нет записи с unit='l'. */
function rowVolumePerUnit(row: ResultRow): number | null {
  const dims = row.dimensions;
  if (!dims) return null;
  for (const d of dims) {
    if (normalizePer(d.unit) === 'l' && Number.isFinite(d.value) && d.value > 0) {
      return d.value;
    }
  }
  return null;
}

interface ColumnDef {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
}

/** Жёстко конвертирует значение в number. Возвращает null, если значение
 *  отсутствует или нечитаемо. Принимает строки с запятой/точкой как
 *  разделителем, чтобы Excel в любой локали распознал ячейку как число. */
function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\u00a0|\s/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const LOCALIZED_NOTES_HEADERS: Record<string, string> = {
  zh: '备注（翻译）',
  en: 'Notes (translated)',
};

function buildColumns(
  currency: string,
  hasRub: boolean,
  hasVolume: boolean,
  hasFreight: boolean,
  language?: string | null,
): ColumnDef[] {
  const columns: ColumnDef[] = [
    { header: 'Наименование', key: 'description', width: 40 },
    { header: 'Количество', key: 'quantity', width: 12, numFmt: '#,##0.####' },
    { header: `Цена (${currency})`, key: 'price', width: 14, numFmt: '#,##0.00' },
    { header: 'Вес (кг)', key: 'weight', width: 12, numFmt: '#,##0.00' },
    ...(hasVolume
      ? [{ header: 'Объём (л)', key: 'volume', width: 14, numFmt: '#,##0.0000' } as ColumnDef]
      : []),
    { header: 'Код ТН ВЭД', key: 'tnVedCode', width: 16 },
    { header: 'Описание ТН ВЭД', key: 'tnVedDescription', width: 35 },
    { header: 'Ставка пошлины', key: 'dutyRateDisplay', width: 20 },
    { header: 'Ставка НДС (%)', key: 'vatRate', width: 16, numFmt: '0.00' },
    { header: `Сумма (${currency})`, key: 'totalPrice', width: 16, numFmt: '#,##0.00' },
    ...(hasFreight
      ? [{ header: `Фрахт до границы (${currency})`, key: 'freightShare', width: 18, numFmt: '#,##0.00' } as ColumnDef]
      : []),
    { header: `Пошлина (${currency})`, key: 'dutyAmount', width: 16, numFmt: '#,##0.00' },
    { header: `НДС (${currency})`, key: 'vatAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Акциз (${currency})`, key: 'exciseAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Комиссия (${currency})`, key: 'logisticsCommission', width: 16, numFmt: '#,##0.00' },
    { header: `Итого (${currency})`, key: 'totalCost', width: 16, numFmt: '#,##0.00' },
  ];

  if (hasRub) {
    columns.push(
      { header: 'Сумма (RUB)', key: 'totalPriceRub', width: 16, numFmt: '#,##0.00' },
      ...(hasFreight
        ? [{ header: 'Фрахт до границы (RUB)', key: 'freightShareRub', width: 18, numFmt: '#,##0.00' } as ColumnDef]
        : []),
      { header: 'Пошлина (RUB)', key: 'dutyAmountRub', width: 16, numFmt: '#,##0.00' },
      { header: 'НДС (RUB)', key: 'vatAmountRub', width: 14, numFmt: '#,##0.00' },
      { header: 'Акциз (RUB)', key: 'exciseAmountRub', width: 14, numFmt: '#,##0.00' },
      { header: 'Комиссия (RUB)', key: 'logisticsCommissionRub', width: 16, numFmt: '#,##0.00' },
      { header: 'Итого (RUB)', key: 'totalCostRub', width: 16, numFmt: '#,##0.00' },
      { header: `Курс ${currency}/RUB`, key: 'exchangeRate', width: 14, numFmt: '0.0000' },
    );
  }

  columns.push({ header: 'Статус', key: 'calculationStatus', width: 20 });
  columns.push({ header: 'Разрешительные документы', key: 'regulatoryDetails', width: 70 });
  columns.push({ header: 'Замечания', key: 'notesText', width: 60 });

  if (language && language !== 'ru' && LOCALIZED_NOTES_HEADERS[language]) {
    columns.push({
      header: LOCALIZED_NOTES_HEADERS[language],
      key: 'notesLocalized',
      width: 60,
    });
  }

  return columns;
}

const STATUS_LABELS: Record<CalculationStatus, string> = {
  exact: 'Точное',
  partial: 'Есть замечания',
  needs_info: 'Требует уточнения',
  error: 'Ошибка',
};

function resolveStatus(row: ResultRow): CalculationStatus {
  if (row.calculationStatus) return row.calculationStatus;
  // Обратная совместимость: старые resultData без calculationStatus
  return row.verificationStatus === 'exact' ? 'exact' : 'partial';
}

function formatNotes(notes: ProductNote[] | undefined, localized = false): string {
  if (!notes || notes.length === 0) return '';
  const order: Record<string, number> = { blocker: 0, warning: 1, info: 2 };
  const sorted = [...notes].sort((a, b) => (order[a.severity] ?? 99) - (order[b.severity] ?? 99));
  return sorted
    .map((n) => {
      const prefix =
        n.severity === 'blocker' ? '⚠ ' : n.severity === 'warning' ? '! ' : '• ';
      const text = localized ? (n.messageLocalized || n.message) : n.message;
      return prefix + text;
    })
    .join('\n');
}

const STATUS_FILLS: Record<CalculationStatus, ExcelJS.Fill> = {
  exact: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
  partial: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
  needs_info: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD5B4' } },
  error: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
};

const STATUS_FONT_COLORS: Record<CalculationStatus, string> = {
  exact: 'FF006100',
  partial: 'FF9C5700',
  needs_info: 'FF974706',
  error: 'FF9C0006',
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

const ROW_HEIGHT_PER_LINE = 15;
const ROW_HEIGHT_PADDING = 5;

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
    const volumesPerUnit = data.map(rowVolumePerUnit);
    const hasVolume = volumesPerUnit.some((v) => v != null);
    // Колонку фрахта добавляем только если хотя бы у одной строки он >0 —
    // иначе она будет пустой и зашумит выгрузку для legacy-документов.
    const hasFreight = data.some((r) => {
      const v = toNumber(r.freightShare);
      return v != null && v > 0;
    });
    const language = doc.language || null;
    const COLUMNS = buildColumns(currency, hasRub, hasVolume, hasFreight, language);
    const hasLocalizedNotes = language != null && language !== 'ru';

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

    const numFmtColumns = COLUMNS.map((col, i) => ({ index: i + 1, numFmt: col.numFmt })).filter(
      (c) => c.numFmt,
    );

    const statusColIdx = COLUMNS.findIndex((c) => c.key === 'calculationStatus') + 1;
    const notesColIdx = COLUMNS.findIndex((c) => c.key === 'notesText') + 1;
    const regulatoryColIdx = COLUMNS.findIndex((c) => c.key === 'regulatoryDetails') + 1;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      const status = resolveStatus(row);
      const notesText = formatNotes(row.notes);
      const regulatoryText = formatRegulatoryReportLong(row.regulatoryReport);

      const volumePerUnit = volumesPerUnit[rowIdx];
      const quantityNum = toNumber(row.quantity);
      const rowData: Record<string, unknown> = {
        description: row.description,
        quantity: quantityNum,
        price: toNumber(row.price),
        weight: toNumber(row.weight),
        ...(hasVolume
          ? {
              volume:
                volumePerUnit != null && quantityNum != null
                  ? volumePerUnit * quantityNum
                  : null,
            }
          : {}),
        tnVedCode: row.tnVedCode || '—',
        tnVedDescription: row.tnVedDescription || '—',
        dutyRateDisplay: row.dutyRateDisplay ?? (row.dutyRate ? `${row.dutyRate}%` : '—'),
        vatRate: toNumber(row.vatRate),
        totalPrice: toNumber(row.totalPrice),
        ...(hasFreight ? { freightShare: toNumber(row.freightShare) } : {}),
        dutyAmount: toNumber(row.dutyAmount),
        vatAmount: toNumber(row.vatAmount),
        exciseAmount: toNumber(row.exciseAmount),
        logisticsCommission: toNumber(row.logisticsCommission),
        totalCost: toNumber(row.totalCost),
        calculationStatus: STATUS_LABELS[status],
        regulatoryDetails: regulatoryText,
        notesText,
      };

      if (hasLocalizedNotes) {
        rowData.notesLocalized = formatNotes(row.notes, true);
      }

      if (hasRub) {
        rowData.totalPriceRub = toNumber(row.totalPriceRub);
        if (hasFreight) rowData.freightShareRub = toNumber(row.freightShareRub);
        rowData.dutyAmountRub = toNumber(row.dutyAmountRub);
        rowData.vatAmountRub = toNumber(row.vatAmountRub);
        rowData.exciseAmountRub = toNumber(row.exciseAmountRub);
        rowData.logisticsCommissionRub = toNumber(row.logisticsCommissionRub);
        rowData.totalCostRub = toNumber(row.totalCostRub);
        rowData.exchangeRate = toNumber(row.exchangeRate);
      }

      const excelRow = sheet.addRow(rowData);

      for (const col of numFmtColumns) {
        excelRow.getCell(col.index).numFmt = col.numFmt!;
      }

      const statusCell = excelRow.getCell(statusColIdx);
      statusCell.fill = STATUS_FILLS[status];
      statusCell.font = { bold: true, color: { argb: STATUS_FONT_COLORS[status] } };
      statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

      if (notesText) {
        const notesCell = excelRow.getCell(notesColIdx);
        notesCell.alignment = { wrapText: true, vertical: 'top' };
        if (status === 'needs_info' || status === 'error') {
          notesCell.fill = STATUS_FILLS[status];
          notesCell.font = { color: { argb: STATUS_FONT_COLORS[status] } };
        }
      }

      const regulatoryCell = excelRow.getCell(regulatoryColIdx);
      regulatoryCell.alignment = { wrapText: true, vertical: 'top' };

      // Высота — по самой высокой из многострочных колонок, иначе ExcelJS не
      // подбирает её автоматически и многострочный текст обрезается.
      const notesLines = notesText ? notesText.split('\n').length : 0;
      const regulatoryLines = regulatoryText ? regulatoryText.split('\n').length : 0;
      const maxLines = Math.max(notesLines, regulatoryLines);
      if (maxLines > 1) {
        excelRow.height = ROW_HEIGHT_PER_LINE * maxLines + ROW_HEIGHT_PADDING;
      }
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.length + 1, column: COLUMNS.length },
    };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    return workbook.xlsx.writeBuffer();
  }

  private async generateRaw(
    workbook: ExcelJS.Workbook,
    data: Record<string, unknown>[],
  ): Promise<ExcelJS.Buffer> {
    const sheet = workbook.getWorksheet('Результат')!;
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      sheet.addRow(headers);
      // price/weight/quantity всегда числа; hsCode/code/description оставляем
      // как есть, чтобы не потерять leading zeros в кодах ТН ВЭД.
      const NUMERIC_KEYS = new Set(['price', 'weight', 'quantity']);
      for (const row of data) {
        sheet.addRow(
          headers.map((h) => {
            const v = row[h];
            if (NUMERIC_KEYS.has(h)) {
              const n = toNumber(v);
              return n != null ? n : v;
            }
            return v;
          }),
        );
      }
    }
    return workbook.xlsx.writeBuffer();
  }
}
