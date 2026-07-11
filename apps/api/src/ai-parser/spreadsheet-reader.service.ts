import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse as csvParseSync } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';
import { ErrorCode } from '../common/error-codes';
import { errMsg } from '../common/errors';

/** Жёсткий потолок числа извлекаемых из xlsx картинок — защита от xlsx с
 *  десятками тысяч встроенных изображений (downstream кап — 200). */
const MAX_EXTRACTED_IMAGES = 300;

/**
 * Потолок суммарного РАСПАКОВАННОГО размера архива и числа записей — защита от
 * zip-бомбы: xlsx.load() полностью разворачивает архив в память ДО применения maxRows,
 * поэтому 40-МБ загрузка из легко сжимаемого XML могла раздуться в гигабайты и уронить
 * воркер по OOM. Легитимный xlsx (даже с сотнями картинок) укладывается в этот бюджет
 * с большим запасом; файл, который распаковывается за него, всё равно не обработать
 * безопасно на поде с ограниченной памятью.
 */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;

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
  /** Имя обработанного листа xlsx. undefined для CSV. */
  sheetName?: string;
  /** Непустые листы xlsx, которые НЕ обработаны (читается один лист).
   *  Парсер превращает их в предупреждение → документ уходит на review. */
  skippedSheets?: { name: string; rows: number }[];
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

/**
 * xlsx — это ZIP-контейнер. Проверяем сигнатуру до тяжёлого xlsx.load: отсекаем
 * переименованный под .xlsx мусор/бинарь (в т.ч. бомбу другого формата) дёшево,
 * не разворачивая архив в память.
 */
function assertZipMagic(buffer: Buffer): void {
  const ok =
    buffer.length >= 4 &&
    buffer[0] === 0x50 && // P
    buffer[1] === 0x4b && // K
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
  if (!ok) {
    throw new BadRequestException({
      code: ErrorCode.FILE_CORRUPTED,
      message: 'Файл не является корректным .xlsx (отсутствует ZIP-сигнатура)',
    });
  }
}

/**
 * Пре-проверка на zip-бомбу ДО xlsx.load: по «центральному каталогу» ZIP суммируем
 * заявленные распакованные размеры записей и отсекаем архив, который развернётся за
 * бюджет памяти. Читаем только каталог (хвост файла) — сами данные не распаковываем.
 *
 * Каталог находим через End Of Central Directory (EOCD, сигнатура PK\x05\x06) в
 * последних ~64 КБ. ZIP64-записи прячут реальный размер в extra-поле, а в 32-битном
 * поле держат сентинел 0xFFFFFFFF (~4 ГБ) — он сам по себе превышает бюджет, поэтому
 * трактуется как «слишком большой» (fail-closed). Остаточный риск: архив может ЗАНИЗИТЬ
 * заявленный размер и всё же развернуться больше — полностью это закрывается только
 * потоковой распаковкой со счётчиком, которую ExcelJS не отдаёт; эта проверка ловит
 * все практичные бомбы (вложенные zip, ZIP64-сокрытие, тысячи записей).
 */
function assertZipNotBomb(buffer: Buffer): void {
  const reject = (message: string): never => {
    throw new BadRequestException({ code: ErrorCode.FILE_TOO_BIG, message });
  };
  const EOCD_SIG = 0x06054b50;
  const CENTRAL_SIG = 0x02014b50;
  // EOCD лежит в последних 22 + comment(≤65535) байтах. Сканируем назад.
  const minStart = Math.max(0, buffer.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    // Валидный zip обязан иметь EOCD; его отсутствие — повреждённый/поддельный архив.
    throw new BadRequestException({
      code: ErrorCode.FILE_CORRUPTED,
      message: 'Файл не является корректным .xlsx (не найден каталог ZIP)',
    });
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  if (entries > MAX_ZIP_ENTRIES) {
    reject(`Слишком много записей в архиве (${entries}) — файл отклонён из соображений безопасности`);
  }
  let ptr = buffer.readUInt32LE(eocd + 16); // смещение начала центрального каталога
  let totalUncompressed = 0;
  for (let i = 0; i < entries; i++) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== CENTRAL_SIG) break;
    const uncompressed = buffer.readUInt32LE(ptr + 24);
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      reject('Файл слишком велик в распакованном виде — отклонён из соображений безопасности');
    }
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
}

/**
 * csv должен быть текстом. NUL-байты в первых килобайтах — верный признак
 * бинарного файла, переименованного в .csv (иначе csv-парсер прочитал бы весь
 * блоб как utf-8).
 */
function assertTextual(buffer: Buffer): void {
  if (buffer.subarray(0, 8192).includes(0x00)) {
    throw new BadRequestException({
      code: ErrorCode.FILE_CORRUPTED,
      message: 'Файл не является корректным .csv (обнаружены бинарные данные)',
    });
  }
}

@Injectable()
export class SpreadsheetReaderService {
  private logger = new Logger(SpreadsheetReaderService.name);

  async read(buffer: Buffer, fileName: string, maxRows = 200): Promise<SpreadsheetData> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      assertTextual(buffer);
      return this.readCsv(buffer, maxRows);
    }
    assertZipMagic(buffer);
    assertZipNotBomb(buffer);
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
    // Обрабатывается ОДИН лист — первый непустой (титульные/пустые листы в начале
    // книги пропускаем). Остальные непустые листы возвращаем списком: парсер
    // добавит предупреждение, чтобы потеря данных не прошла молча.
    const sheet =
      workbook.worksheets.find((s) => (s.actualRowCount ?? 0) > 0) ?? workbook.worksheets[0];
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

    // Лист из одной строки — почти наверняка титульник/примечание, не таблица.
    const skippedSheets = workbook.worksheets
      .filter((s) => s !== sheet && (s.actualRowCount ?? 0) >= 2)
      .map((s) => ({ name: s.name, rows: s.actualRowCount ?? 0 }));

    this.logger.log(
      `Read XLSX: sheet "${sheet.name}", ${rows.length} rows, ${columnCount} columns, ` +
        `${images.length} images${skippedSheets.length > 0 ? `, skipped sheets: ${skippedSheets.map((s) => s.name).join(', ')}` : ''}`,
    );
    return {
      rows,
      columnCount,
      images,
      sheetName: sheet.name,
      ...(skippedSheets.length > 0 ? { skippedSheets } : {}),
    };
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
      // На патологическом xlsx с десятками тысяч anchor'ов обрезаем до того, как
      // материализуем буферы через getImage (downstream обрежет до 200, но здесь
      // экономим и getImage-вызовы, и размер возвращаемого массива).
      if (result.length >= MAX_EXTRACTED_IMAGES) break;
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
