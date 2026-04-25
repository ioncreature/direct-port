import { Injectable, Logger } from '@nestjs/common';
import { parse as csvParseSync } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';
import { errMsg } from '../common/errors';

export interface SpreadsheetImage {
  /** 0-indexed excel row, к которой xlsx-anchor привязал картинку. */
  rowIndex: number;
  bytes: Buffer;
  extension: string;
}

export interface SpreadsheetData {
  rows: string[][];
  columnCount: number;
  /** Встроенные картинки из xlsx, привязанные к строкам через twoCellAnchor.from.row. Пусто для CSV. */
  images: SpreadsheetImage[];
}

interface ExcelJsImageAnchor {
  imageId: string | number;
  range?: { tl?: { nativeRow?: number; row?: number } };
}

interface ExcelJsImageMedia {
  buffer?: Buffer;
  extension?: string;
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
    this.logger.log(`Loading XLSX: buffer ${buffer.length} bytes`);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      this.logger.error(`Failed to load XLSX (${buffer.length} bytes)`, err);
      throw err;
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      this.logger.warn('XLSX has no worksheets');
      return { rows: [], columnCount: 0, images: [] };
    }

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

    const images = this.extractXlsxImages(workbook, sheet);

    this.logger.log(
      `Read XLSX: ${rows.length} rows, ${columnCount} columns, ${images.length} images`,
    );
    return { rows, columnCount, images };
  }

  /**
   * Сопоставляет встроенные картинки со строками через twoCellAnchor.from.row
   * (0-indexed). Возвращаются raw — ресайз и хэширование делает PhotoStorageService.
   */
  private extractXlsxImages(
    workbook: ExcelJS.Workbook,
    sheet: ExcelJS.Worksheet,
  ): SpreadsheetImage[] {
    const result: SpreadsheetImage[] = [];
    let anchors: ExcelJsImageAnchor[] = [];
    try {
      anchors = sheet.getImages() as ExcelJsImageAnchor[];
    } catch (err) {
      this.logger.warn(`getImages() failed: ${errMsg(err)}`);
      return result;
    }
    for (const anchor of anchors) {
      const tl = anchor.range?.tl;
      const rowIndex = tl?.nativeRow ?? tl?.row;
      if (rowIndex == null || !Number.isFinite(rowIndex)) continue;
      let media: ExcelJsImageMedia | undefined;
      try {
        media = workbook.getImage(Number(anchor.imageId)) as unknown as ExcelJsImageMedia;
      } catch (err) {
        this.logger.warn(`getImage(${anchor.imageId}) failed: ${errMsg(err)}`);
        continue;
      }
      const buffer = media?.buffer;
      if (!buffer || buffer.length === 0) continue;
      result.push({
        rowIndex: Math.floor(Number(rowIndex)),
        bytes: buffer,
        extension: media?.extension ?? 'png',
      });
    }
    return result;
  }

  private readCsv(buffer: Buffer, maxRows: number): SpreadsheetData {
    this.logger.log(`Loading CSV: buffer ${buffer.length} bytes`);
    let records: string[][];
    try {
      records = csvParseSync(buffer.toString('utf-8'), {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';', '\t'],
        to: maxRows,
      }) as string[][];
    } catch (err) {
      this.logger.error(`Failed to parse CSV (${buffer.length} bytes)`, err);
      throw err;
    }

    const columnCount = records.reduce((max, row) => Math.max(max, row.length), 0);
    const rows = records.map((row) => row.map((cell) => (cell ?? '').trim()));

    this.logger.log(`Read CSV: ${rows.length} rows, ${columnCount} columns`);
    return { rows, columnCount, images: [] };
  }
}
