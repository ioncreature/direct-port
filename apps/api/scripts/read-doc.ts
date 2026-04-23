#!/usr/bin/env tsx
/*
 * Универсальный читатель .xlsx/.csv для просмотра содержимого в LLM-friendly виде.
 *
 * Использование (из корня репозитория):
 *   pnpm read-doc <path> [<path2> ...] [--max-rows N] [--max-col-width N] [--json] [--full]
 *
 * Примеры:
 *   pnpm read-doc temp/in_1.xlsx
 *   pnpm read-doc temp/in_1.xlsx temp/in_1_result.xlsx
 *   pnpm read-doc temp/DP_*.xlsx --max-rows 50
 *   pnpm read-doc temp/in_1.xlsx --json > /tmp/dump.json
 *
 * Формат вывода (по умолчанию):
 *   == file.xlsx (xlsx) ==
 *   [sheet "Sheet1" — 12 rows × 4 cols]
 *    H: header1 | header2 | header3 | header4
 *    1: val | val | val | val
 *   ...
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as csvParseSync } from 'csv-parse/sync';
import * as ExcelJS from 'exceljs';

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_MAX_COL_WIDTH = 80;
const FULL_LIMIT = 10_000;

interface SheetDump {
  name: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  truncated: boolean;
}

interface FileDump {
  file: string;
  type: 'xlsx' | 'csv';
  sheets: SheetDump[];
}

function extractCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) {
      return (value.richText as Array<{ text: string }>).map((rt) => rt.text).join('');
    }
    if ('result' in value) return extractCellValue(value.result as ExcelJS.CellValue);
    if ('hyperlink' in value && 'text' in value) {
      return String((value as { text: unknown }).text ?? '');
    }
    if ('error' in value) return `#ERR(${String((value as { error: unknown }).error)})`;
    if ('formula' in value && 'result' in value) {
      return extractCellValue((value as { result: ExcelJS.CellValue }).result);
    }
  }
  return String(value);
}

async function dumpXlsx(filePath: string, maxRows: number): Promise<FileDump> {
  const buffer = fs.readFileSync(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: SheetDump[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[][] = [];
    let columnCount = 0;
    const totalNonEmpty = sheet.actualRowCount;
    for (let r = 1; r <= sheet.rowCount; r++) {
      if (rows.length >= maxRows) break;
      const row = sheet.getRow(r);
      if (!row.hasValues) continue;
      const cells: string[] = [];
      const colCount = Math.max(sheet.columnCount, row.cellCount);
      for (let c = 1; c <= colCount; c++) {
        cells.push(extractCellValue(row.getCell(c).value));
      }
      while (cells.length > 0 && cells.at(-1) === '') cells.pop();
      rows.push(cells);
      columnCount = Math.max(columnCount, cells.length);
    }
    sheets.push({
      name: sheet.name,
      rows,
      rowCount: totalNonEmpty,
      columnCount,
      truncated: totalNonEmpty > rows.length,
    });
  }
  return { file: filePath, type: 'xlsx', sheets };
}

function dumpCsv(filePath: string, maxRows: number): FileDump {
  const buffer = fs.readFileSync(filePath);
  const records = csvParseSync(buffer.toString('utf-8'), {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: [',', ';', '\t'],
  }) as string[][];
  const truncated = records.length > maxRows;
  const slice = records.slice(0, maxRows);
  const columnCount = slice.reduce((max, r) => Math.max(max, r.length), 0);
  return {
    file: filePath,
    type: 'csv',
    sheets: [
      { name: 'csv', rows: slice, rowCount: records.length, columnCount, truncated },
    ],
  };
}

function clip(text: string, maxLen: number): string {
  const collapsed = text.replace(/[\r\n\t]+/g, ' ⏎ ').replace(/ {2,}/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1) + '…';
}

function formatDump(dump: FileDump, maxColWidth: number): string {
  const out: string[] = [];
  out.push(`== ${path.basename(dump.file)} (${dump.type}) ==`);
  for (const sheet of dump.sheets) {
    const truncNote = sheet.truncated ? ` (showing first ${sheet.rows.length})` : '';
    out.push(
      `[sheet "${sheet.name}" — ${sheet.rowCount} rows${truncNote} × ${sheet.columnCount} cols]`,
    );
    const indexWidth = String(Math.max(sheet.rows.length - 1, 1)).length;
    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const prefix = i === 0 ? 'H'.padStart(indexWidth, ' ') : String(i).padStart(indexWidth, ' ');
      const cells = row.map((c) => clip(c, maxColWidth));
      out.push(`${prefix}: ${cells.join(' | ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.error(
      'Usage: pnpm read-doc <path> [<path2> ...] [--max-rows N] [--max-col-width N] [--json] [--full]',
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  let maxRows = DEFAULT_MAX_ROWS;
  let maxColWidth = DEFAULT_MAX_COL_WIDTH;
  let asJson = false;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a === '--max-rows') maxRows = Number(args[++i] ?? DEFAULT_MAX_ROWS);
    else if (a === '--max-col-width') maxColWidth = Number(args[++i] ?? DEFAULT_MAX_COL_WIDTH);
    else if (a === '--json') asJson = true;
    else if (a === '--full') {
      maxRows = FULL_LIMIT;
      maxColWidth = FULL_LIMIT;
    } else if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else files.push(a);
  }

  const initCwd = process.env.INIT_CWD ?? process.cwd();
  const dumps: FileDump[] = [];

  for (const file of files) {
    const resolved = path.isAbsolute(file) ? file : path.resolve(initCwd, file);
    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.csv') dumps.push(dumpCsv(resolved, maxRows));
    else if (ext === '.xlsx' || ext === '.xlsm') dumps.push(await dumpXlsx(resolved, maxRows));
    else {
      console.error(`Unsupported extension: ${ext} (${resolved})`);
      process.exit(3);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(dumps, null, 2));
  } else {
    console.log(dumps.map((d) => formatDump(d, maxColWidth)).join('\n'));
  }
}

main().catch((e: NodeJS.ErrnoException) => {
  if (e?.code === 'ENOENT') {
    console.error(`File not found: ${e.path ?? ''}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(99);
});
