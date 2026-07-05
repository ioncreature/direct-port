import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { normalizePer } from '../calculator/calculator.service';
import { errMsg } from '../common/errors';
import {
  PhotoStorageService,
  type RowPhotoThumbnail,
} from '../photo-storage/photo-storage.service';
import type { ProductAttributes } from '../common/product-attributes';
import type { CalculationStatus, ProductNote } from '../common/product-notes';
import { incotermsCustomsValueSummary, incotermsGrafa20Label } from '../common/incoterms-info';
import { Document } from '../database/entities/document.entity';
import type { Dimension } from '../duty-interpreter/interfaces';
import type { RegulatoryReport } from '../regulatory/interfaces';
import { formatRegulatoryReportLong } from '../regulatory/regulatory-format';
import { OKSMT_BY_CODE } from '../countries/oksmt.data';
import { buildDtProject, type DtProject } from './dt-project';
import {
  buildShipmentChecklist,
  CONFIDENCE_LABELS,
  TIMING_LABELS,
  TIMING_ORDER,
  type ShipmentChecklist,
} from './shipment-checklist';
import type { ChecklistConfidence } from '../regulatory/curated/interfaces';

interface ResultRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  weightGross?: number | null;
  attributes?: ProductAttributes | null;
  countryOfOrigin?: string | null;
  dimensions?: Dimension[] | null;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  dutyRateDisplay?: string;
  vatRate: number;
  exciseRate: number;
  supplementaryUnit?: string | null;
  supplementaryQuantity?: number | null;
  totalPrice: number;
  freightShare?: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  totalCost: number;
  totalPriceRub?: number;
  freightShareRub?: number;
  dutyAmountRub?: number;
  vatAmountRub?: number;
  exciseAmountRub?: number;
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

/**
 * Защита от формула-инъекции (CSV injection): значения из ввода клиента
 * (наименования, коды ТН ВЭД, замечания) попадают в ячейки as-is. Если значение
 * начинается с =, +, -, @, таба или CR, Excel/LibreOffice при открытии могут
 * интерпретировать его как формулу (вплоть до DDE). Префиксуем апострофом — он
 * не отображается, но заставляет приложение трактовать ячейку как текст.
 */
function csvSafe(value: unknown): unknown {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

const LOCALIZED_NOTES_HEADERS: Record<string, string> = {
  zh: '备注（翻译）',
  en: 'Notes (translated)',
};

const LOCALIZED_TITLE_HEADERS: Record<string, string> = {
  zh: '文件（翻译）',
  en: 'Document (translated)',
};

/** Статус расчёта, чьи заливка/шрифт переиспользуются для уверенности чек-листа. */
const CONFIDENCE_STATUS: Record<ChecklistConfidence, CalculationStatus> = {
  confirmed: 'exact',
  probable: 'partial',
  check: 'needs_info',
};

function buildColumns(
  currency: string,
  hasRub: boolean,
  hasVolume: boolean,
  hasFreight: boolean,
  language?: string | null,
  hasGrossWeight = false,
  hasSupplementary = false,
  hasDtNumbers = false,
  hasRowCountry = false,
  hasPhotos = false,
): ColumnDef[] {
  const columns: ColumnDef[] = [
    // «№ товара ДТ» — первая колонка: декларантское ПО (Контур/Альта/СТМ) группирует
    // строки в товары декларации по этому номеру при импорте xlsx.
    ...(hasDtNumbers
      ? [{ header: '№ товара ДТ', key: 'dtGoodNumber', width: 10, numFmt: '0' } as ColumnDef]
      : []),
    { header: 'Наименование', key: 'description', width: 40 },
    // Ширина 18 ≈ 126px — под миниатюру ≤120px (~7px на единицу ширины колонки).
    ...(hasPhotos ? [{ header: 'Фото', key: 'photo', width: 18 } as ColumnDef] : []),
    { header: 'Количество', key: 'quantity', width: 12, numFmt: '#,##0.####' },
    { header: `Цена (${currency})`, key: 'price', width: 14, numFmt: '#,##0.00' },
    // «Вес нетто» вместо «Вес» только при наличии брутто: для legacy-документов
    // с одной колонкой веса заголовок не меняем.
    {
      header: hasGrossWeight ? 'Вес нетто (кг)' : 'Вес (кг)',
      key: 'weight',
      width: 12,
      numFmt: '#,##0.00',
    },
    ...(hasGrossWeight
      ? [{ header: 'Вес брутто (кг)', key: 'weightGross', width: 14, numFmt: '#,##0.00' } as ColumnDef]
      : []),
    ...(hasVolume
      ? [{ header: 'Объём (л)', key: 'volume', width: 14, numFmt: '#,##0.0000' } as ColumnDef]
      : []),
    { header: 'Код ТН ВЭД', key: 'tnVedCode', width: 16 },
    { header: 'Описание ТН ВЭД', key: 'tnVedDescription', width: 35 },
    ...(hasRowCountry
      ? [{ header: 'Страна происх.', key: 'countryDisplay', width: 18 } as ColumnDef]
      : []),
    ...(hasSupplementary
      ? [{ header: 'Доп. единица (гр. 41 ДТ)', key: 'supplementaryDisplay', width: 20 } as ColumnDef]
      : []),
    { header: 'Ставка пошлины', key: 'dutyRateDisplay', width: 20 },
    { header: 'Ставка НДС (%)', key: 'vatRate', width: 16, numFmt: '0.00' },
    { header: `Сумма (${currency})`, key: 'totalPrice', width: 16, numFmt: '#,##0.00' },
    ...(hasFreight
      ? [{ header: `Фрахт до границы (${currency})`, key: 'freightShare', width: 18, numFmt: '#,##0.00' } as ColumnDef]
      : []),
    { header: `Пошлина (${currency})`, key: 'dutyAmount', width: 16, numFmt: '#,##0.00' },
    { header: `НДС (${currency})`, key: 'vatAmount', width: 14, numFmt: '#,##0.00' },
    { header: `Акциз (${currency})`, key: 'exciseAmount', width: 14, numFmt: '#,##0.00' },
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

/** «156 КИТАЙ» для строк со своей страной происхождения; пусто, если страны нет. */
function formatCountry(code: string | null | undefined): string {
  if (!code) return '';
  const name = OKSMT_BY_CODE.get(code)?.nameRu;
  return name ? `${code} ${name}` : code;
}

/** Текст «Доп. единицы» (гр. 41): «1200 пар», либо «нет данных (л)» когда код
 *  требует единицу, а количества в ней нет. Пусто — доп. единица не требуется.
 *  Общий формат построчного листа и листа «Проект ДТ». */
function formatSupplementary(unit: string | null | undefined, quantity: unknown): string {
  if (!unit) return '';
  const qty = toNumber(quantity);
  if (qty != null) {
    const formatted = String(Math.round(qty * 10000) / 10000);
    return `${formatted} ${unit}`;
  }
  return `нет данных (${unit})`;
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
/** Высота строки Excel задаётся в пунктах: 1px ≈ 0.75pt. */
const PX_TO_PT = 0.75;
const PHOTO_ROW_PADDING_PT = 6;

@Injectable()
export class ExcelExportService {
  private logger = new Logger(ExcelExportService.name);

  constructor(private photoStorage: PhotoStorageService) {}

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
    const hasGrossWeight = data.some((r) => {
      const v = toNumber(r.weightGross);
      return v != null && v > 0;
    });
    const hasSupplementary = data.some((r) => !!r.supplementaryUnit);
    const language = doc.language || null;

    // «Проект ДТ»: группировка строк в товары декларации (второй лист) + номера
    // товаров для построчного листа.
    const dtProject = buildDtProject({
      rows: data,
      docCountryOfOrigin: doc.countryOfOrigin,
      currency,
      exchangeRates: doc.exchangeRates,
    });
    const rowToGood = new Map<number, number>();
    for (const good of dtProject.goods) {
      for (const rowNumber of good.rowNumbers) rowToGood.set(rowNumber, good.goodNumber);
    }
    const hasDtNumbers = dtProject.goods.length > 0;
    // Колонка страны — только когда в строках есть собственная страна происхождения
    // (сборные инвойсы); для обычных документов страна одна на документ.
    const hasRowCountry = data.some((r) => !!r.countryOfOrigin);

    // Фото из document_photo (привязаны к индексам parsedData = индексам resultData).
    const photoByRow = await this.loadRowThumbnails(doc.id);
    const hasPhotos = photoByRow.size > 0;

    const COLUMNS = buildColumns(
      currency,
      hasRub,
      hasVolume,
      hasFreight,
      language,
      hasGrossWeight,
      hasSupplementary,
      hasDtNumbers,
      hasRowCountry,
      hasPhotos,
    );
    const hasLocalizedNotes = language != null && language !== 'ru';

    sheet.columns = COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));
    this.styleHeaderRow(sheet);

    const numFmtColumns = COLUMNS.map((col, i) => ({ index: i + 1, numFmt: col.numFmt })).filter(
      (c) => c.numFmt,
    );

    const statusColIdx = COLUMNS.findIndex((c) => c.key === 'calculationStatus') + 1;
    const notesColIdx = COLUMNS.findIndex((c) => c.key === 'notesText') + 1;
    const regulatoryColIdx = COLUMNS.findIndex((c) => c.key === 'regulatoryDetails') + 1;
    // 0-based индекс колонки «Фото» — anchor картинок в ExcelJS считается с нуля.
    const photoColIdx = COLUMNS.findIndex((c) => c.key === 'photo');
    // Одинаковые изображения (по hash) регистрируются в workbook один раз.
    const imageIdByHash = new Map<string, number>();

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      const status = resolveStatus(row);
      const notesText = formatNotes(row.notes);
      const regulatoryText = formatRegulatoryReportLong(row.regulatoryReport);

      const volumePerUnit = volumesPerUnit[rowIdx];
      const quantityNum = toNumber(row.quantity);
      const rowData: Record<string, unknown> = {
        ...(hasDtNumbers ? { dtGoodNumber: rowToGood.get(rowIdx + 1) ?? null } : {}),
        description: row.description,
        quantity: quantityNum,
        price: toNumber(row.price),
        weight: toNumber(row.weight),
        ...(hasGrossWeight ? { weightGross: toNumber(row.weightGross) } : {}),
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
        ...(hasRowCountry ? { countryDisplay: formatCountry(row.countryOfOrigin) } : {}),
        ...(hasSupplementary
          ? {
              supplementaryDisplay: formatSupplementary(
                row.supplementaryUnit,
                row.supplementaryQuantity,
              ),
            }
          : {}),
        dutyRateDisplay: row.dutyRateDisplay ?? (row.dutyRate ? `${row.dutyRate}%` : '—'),
        vatRate: toNumber(row.vatRate),
        totalPrice: toNumber(row.totalPrice),
        ...(hasFreight ? { freightShare: toNumber(row.freightShare) } : {}),
        dutyAmount: toNumber(row.dutyAmount),
        vatAmount: toNumber(row.vatAmount),
        exciseAmount: toNumber(row.exciseAmount),
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
        rowData.totalCostRub = toNumber(row.totalCostRub);
        rowData.exchangeRate = toNumber(row.exchangeRate);
      }

      for (const key of Object.keys(rowData)) {
        rowData[key] = csvSafe(rowData[key]);
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

      const photo = photoByRow.get(rowIdx);
      if (photo) {
        let imageId = imageIdByHash.get(photo.imageHash);
        if (imageId === undefined) {
          // ExcelJS.Buffer типизирован как ArrayBuffer и несовместим с Node Buffer,
          // при этом runtime принимает Node Buffer (тот же приём в client-portal).
          imageId = workbook.addImage({
            buffer: photo.bytes as unknown as ExcelJS.Buffer,
            extension: 'jpeg',
          });
          imageIdByHash.set(photo.imageHash, imageId);
        }
        // tl — zero-based координаты ячейки (excelRow.number — 1-based строка листа);
        // editAs: 'oneCell' — картинка следует за ячейкой при сортировке/фильтрации.
        sheet.addImage(imageId, {
          tl: { col: photoColIdx + 0.1, row: excelRow.number - 1 + 0.1 },
          ext: { width: photo.width, height: photo.height },
          editAs: 'oneCell',
        });
      }

      // Высота — по самой высокой из многострочных колонок (иначе ExcelJS не
      // подбирает её автоматически и текст обрезается) либо по миниатюре фото.
      const notesLines = notesText ? notesText.split('\n').length : 0;
      const regulatoryLines = regulatoryText ? regulatoryText.split('\n').length : 0;
      const maxLines = Math.max(notesLines, regulatoryLines);
      const textHeight = maxLines > 1 ? ROW_HEIGHT_PER_LINE * maxLines + ROW_HEIGHT_PADDING : 0;
      const photoHeight = photo ? photo.height * PX_TO_PT + PHOTO_ROW_PADDING_PT : 0;
      const rowHeight = Math.max(textHeight, photoHeight);
      if (rowHeight > 0) {
        excelRow.height = rowHeight;
      }
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: data.length + 1, column: COLUMNS.length },
    };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const docHasFreight = doc.freightCost != null && Number(doc.freightCost) > 0;
    if (hasDtNumbers) {
      this.addDtProjectSheet(workbook, dtProject, currency, doc.incoterms, docHasFreight);
    }

    const checklist = buildShipmentChecklist({
      rows: data,
      docCountryOfOrigin: doc.countryOfOrigin,
      incoterms: doc.incoterms,
      freightCost: doc.freightCost,
      language,
    });
    this.addShipmentChecklistSheet(workbook, checklist, language);

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Миниатюры фото по строкам документа. Фото — украшение выгрузки: любой их сбой
   * (недоступная БД, битые байты) не должен ронять скачивание расчёта.
   */
  private async loadRowThumbnails(
    documentId: string | undefined,
  ): Promise<Map<number, RowPhotoThumbnail>> {
    if (!documentId) return new Map();
    try {
      const thumbs = await this.photoStorage.getRowThumbnails(documentId);
      return new Map(thumbs.map((t) => [t.rowIndex, t]));
    } catch (err) {
      this.logger.warn(`Failed to load photo thumbnails for ${documentId}: ${errMsg(err)}`);
      return new Map();
    }
  }

  /** Общая стилизация строки заголовков листа (синяя шапка, перенос, высота). */
  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 30;
  }

  /**
   * Лист «Проект ДТ»: строки листа «Результат», сгруппированные в товары декларации
   * (код ТН ВЭД + страна происхождения) с агрегатами в терминах граф ДТ. Черновик
   * для переноса в декларантское ПО — данные обязан проверить декларант.
   */
  private addDtProjectSheet(
    workbook: ExcelJS.Workbook,
    project: DtProject,
    currency: string,
    incoterms: string | null,
    hasFreight: boolean,
  ): void {
    const sheet = workbook.addWorksheet('Проект ДТ');

    const columns: ColumnDef[] = [
      { header: '№ товара', key: 'goodNumber', width: 10, numFmt: '0' },
      { header: 'Код ТН ВЭД (гр. 33)', key: 'tnVedCode', width: 16 },
      { header: 'Описание — черновик (гр. 31)', key: 'descriptionDraft', width: 55 },
      { header: 'Страна происх. (гр. 34)', key: 'country', width: 18 },
      { header: 'Брутто, кг (гр. 35)', key: 'grossWeightKg', width: 14, numFmt: '#,##0.000' },
      { header: 'Нетто, кг (гр. 38)', key: 'netWeightKg', width: 14, numFmt: '#,##0.000' },
      { header: 'Доп. единица (гр. 41)', key: 'supplementary', width: 16 },
      { header: `Цена товара (гр. 42), ${currency}`, key: 'invoiceValue', width: 18, numFmt: '#,##0.00' },
      { header: 'Таможенная стоимость (гр. 45), RUB', key: 'customsValueRub', width: 20, numFmt: '#,##0.00' },
      { header: 'Статистическая стоимость (гр. 46), USD', key: 'statisticalValueUsd', width: 20, numFmt: '#,##0.00' },
      { header: 'Пошлина (гр. 47), RUB', key: 'dutyRub', width: 16, numFmt: '#,##0.00' },
      { header: 'Акциз (гр. 47), RUB', key: 'exciseRub', width: 14, numFmt: '#,##0.00' },
      { header: 'НДС (гр. 47), RUB', key: 'vatRub', width: 16, numFmt: '#,##0.00' },
      { header: 'ИТС, $/кг нетто', key: 'itcUsdPerKg', width: 14, numFmt: '#,##0.00' },
      { header: 'Документы (гр. 44)', key: 'documentHints', width: 45 },
      { header: 'Строки листа «Результат»', key: 'rowNumbers', width: 20 },
      { header: 'Предупреждения', key: 'warnings', width: 55 },
    ];

    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    this.styleHeaderRow(sheet);

    const numFmtColumns = columns
      .map((col, i) => ({ index: i + 1, numFmt: col.numFmt }))
      .filter((c) => c.numFmt);
    const wrapKeys = new Set(['descriptionDraft', 'documentHints', 'warnings']);
    const wrapIdx = columns.flatMap((c, i) => (wrapKeys.has(c.key) ? [i + 1] : []));

    for (const good of project.goods) {
      const rowData: Record<string, unknown> = {
        goodNumber: good.goodNumber,
        tnVedCode: good.tnVedCode,
        descriptionDraft: good.descriptionDraft,
        country: good.countryCode ? formatCountry(good.countryCode) : '—',
        grossWeightKg: good.grossWeightKg,
        netWeightKg: good.netWeightKg,
        supplementary: formatSupplementary(good.supplementaryUnit, good.supplementaryQuantity),
        invoiceValue: good.invoiceValue,
        customsValueRub: good.customsValueRub,
        statisticalValueUsd: good.statisticalValueUsd,
        dutyRub: good.dutyRub,
        exciseRub: good.exciseRub,
        vatRub: good.vatRub,
        itcUsdPerKg: good.itcUsdPerKg,
        documentHints: good.documentHints.join('\n'),
        rowNumbers: good.rowNumbers.join(', '),
        warnings: good.warnings.join('\n'),
      };
      for (const key of Object.keys(rowData)) rowData[key] = csvSafe(rowData[key]);
      const excelRow = sheet.addRow(rowData);
      for (const col of numFmtColumns) excelRow.getCell(col.index).numFmt = col.numFmt!;
      for (const idx of wrapIdx) {
        excelRow.getCell(idx).alignment = { wrapText: true, vertical: 'top' };
      }
      const lines = Math.max(
        good.descriptionDraft.split('\n').length,
        good.documentHints.length,
        good.warnings.length,
        1,
      );
      if (lines > 1) excelRow.height = ROW_HEIGHT_PER_LINE * lines + ROW_HEIGHT_PADDING;
    }

    // Итоговый блок: label в колонке «Описание», значение — в стоимостной колонке.
    const labelColIdx = columns.findIndex((c) => c.key === 'descriptionDraft') + 1;
    const valueColIdx = columns.findIndex((c) => c.key === 'customsValueRub') + 1;
    const summary: Array<[string, unknown]> = [
      [
        'ИТОГО таможенная стоимость (гр. 45), RUB',
        project.totals.customsValueRub ?? 'не рассчитана (нет курса ЦБ)',
      ],
      [
        'ИТОГО статистическая стоимость (гр. 46), USD',
        project.totals.statisticalValueUsd ?? 'не рассчитана (нет курса USD)',
      ],
      [
        'Сбор за таможенные операции (код 1010), RUB',
        project.totals.customsFeeRub ?? 'не рассчитан',
      ],
      [
        'ДТС-1',
        project.totals.needsDts1 == null
          ? '—'
          : project.totals.needsDts1
            ? 'ТРЕБУЕТСЯ (стоимость партии > эквивалента $10 000)'
            : 'не требуется (партия ≤ $10 000; кроме многоразовых/повторяющихся поставок)',
      ],
    ];
    const grafa20 = incotermsGrafa20Label(incoterms);
    if (grafa20) summary.unshift(['Условия поставки (гр. 20)', grafa20]);
    sheet.addRow([]);
    for (const [label, value] of summary) {
      const row = sheet.addRow({ descriptionDraft: label, customsValueRub: csvSafe(value) });
      row.getCell(labelColIdx).font = { bold: true };
      if (typeof value === 'number') row.getCell(valueColIdx).numFmt = '#,##0.00';
    }

    const impact = incotermsCustomsValueSummary(incoterms, hasFreight);
    if (impact.length > 0) {
      sheet.addRow([]);
      const head = sheet.addRow({
        descriptionDraft: csvSafe(
          `Условия поставки ${grafa20 ?? incoterms}: как влияет на таможенную стоимость этого документа`,
        ),
      });
      head.getCell(labelColIdx).font = { bold: true };
      head.getCell(labelColIdx).alignment = { wrapText: true, vertical: 'top' };
      for (const line of impact) {
        const row = sheet.addRow({ descriptionDraft: csvSafe(line) });
        row.getCell(labelColIdx).alignment = { wrapText: true, vertical: 'top' };
        row.getCell(labelColIdx).font = { italic: true };
      }
    }

    sheet.addRow([]);
    const notes = [
      ...project.warnings,
      'ИТС ($/кг нетто) ниже профиля риска ФТС по коду ТН ВЭД — типичный триггер запроса документов ' +
        'и КТС: проверьте позиции с минимальными значениями и подготовьте подтверждение стоимости.',
      'Черновик для переноса в декларантское ПО (Контур.Декларант / Альта-ГТД / ВЭД-Декларант). ' +
        'Не является декларацией — сведения проверяет и дополняет декларант.',
    ];
    for (const note of notes) {
      const row = sheet.addRow({ descriptionDraft: csvSafe(note) });
      row.getCell(labelColIdx).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(labelColIdx).font = { italic: true };
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  /**
   * Лист «Документы к поставке»: чек-лист документов, сгруппированный по моменту
   * получения (до заказа → к отгрузке → к подаче ДТ → на случай запроса), с кодами
   * графы 44, основанием и статусом уверенности. Источник — buildShipmentChecklist
   * (базовый пакет ст. 108 + меры TKS по строкам + curated-слой).
   */
  private addShipmentChecklistSheet(
    workbook: ExcelJS.Workbook,
    checklist: ShipmentChecklist,
    language: string | null,
  ): void {
    const sheet = workbook.addWorksheet('Документы к поставке');
    const hasLocalized =
      language != null && language !== 'ru' && checklist.items.some((i) => i.titleLocalized);

    const columns: ColumnDef[] = [
      { header: 'Документ', key: 'title', width: 46 },
      ...(hasLocalized
        ? [
            {
              header: LOCALIZED_TITLE_HEADERS[language] ?? LOCALIZED_TITLE_HEADERS.en,
              key: 'titleLocalized',
              width: 42,
            } as ColumnDef,
          ]
        : []),
      { header: 'Код гр. 44', key: 'g44Code', width: 12 },
      { header: 'Статус', key: 'confidence', width: 18 },
      { header: 'Строки', key: 'rows', width: 14 },
      { header: 'Основание', key: 'basis', width: 42 },
      { header: 'Пояснение', key: 'details', width: 80 },
    ];

    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    this.styleHeaderRow(sheet);

    const sectionFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' },
    };
    const confidenceColIdx = columns.findIndex((c) => c.key === 'confidence') + 1;
    const wrapIdx = columns.flatMap((c, i) =>
      ['title', 'titleLocalized', 'basis', 'details'].includes(c.key) ? [i + 1] : [],
    );

    for (const warning of checklist.warnings) {
      const row = sheet.addRow({ title: csvSafe(`⚠ ${warning}`) });
      row.getCell(1).font = { bold: true, color: { argb: STATUS_FONT_COLORS.error } };
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    }
    if (checklist.warnings.length > 0) sheet.addRow([]);

    for (const timing of TIMING_ORDER) {
      const items = checklist.items.filter((i) => i.timing === timing);
      if (items.length === 0) continue;

      const section = sheet.addRow({ title: TIMING_LABELS[timing] });
      for (let col = 1; col <= columns.length; col++) section.getCell(col).fill = sectionFill;
      section.getCell(1).font = { bold: true, size: 11 };

      for (const item of items) {
        const rowData: Record<string, unknown> = {
          title: item.title,
          ...(hasLocalized ? { titleLocalized: item.titleLocalized ?? '' } : {}),
          g44Code: item.g44Code ?? '—',
          confidence: CONFIDENCE_LABELS[item.confidence],
          rows: item.scope === 'rows' ? item.rowNumbers.join(', ') : 'вся поставка',
          basis: item.basis,
          details: item.details ?? '',
        };
        for (const key of Object.keys(rowData)) rowData[key] = csvSafe(rowData[key]);
        const excelRow = sheet.addRow(rowData);

        const status = CONFIDENCE_STATUS[item.confidence];
        const confidenceCell = excelRow.getCell(confidenceColIdx);
        confidenceCell.fill = STATUS_FILLS[status];
        confidenceCell.font = { bold: true, color: { argb: STATUS_FONT_COLORS[status] } };
        confidenceCell.alignment = { vertical: 'middle', horizontal: 'center' };

        for (const idx of wrapIdx) {
          excelRow.getCell(idx).alignment = { wrapText: true, vertical: 'top' };
        }
        // Пояснения длинные: высота из расчёта ~85 символов на строку колонки.
        const detailsLines = Math.ceil((item.details ?? '').length / 85);
        if (detailsLines > 1) excelRow.height = ROW_HEIGHT_PER_LINE * detailsLines + ROW_HEIGHT_PADDING;
      }
    }

    sheet.addRow([]);
    const disclaimer = sheet.addRow({
      title: csvSafe(
        'Чек-лист носит информационный характер и не заменяет консультацию таможенного ' +
          'представителя. Пункты со статусом «Проверьте» зависят от свойств товара — ' +
          'уточните применимость по описанию. Основания указаны в колонке «Основание»; ' +
          'даты и перечни выверены на дату формирования расчёта.',
      ),
    });
    disclaimer.getCell(1).font = { italic: true };
    disclaimer.getCell(1).alignment = { wrapText: true, vertical: 'top' };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
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
              return n != null ? n : csvSafe(v);
            }
            return csvSafe(v);
          }),
        );
      }
    }
    return workbook.xlsx.writeBuffer();
  }
}
