import type { GoodsItem, OperationType, TnvedCode } from './types';
import { Priznak } from './types';

/**
 * Форматирует 10-значный код ТН ВЭД в читаемый вид.
 * "0201100001" → "0201 10 000 1"
 */
export function formatTnvedCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6, 9)} ${code.slice(9)}`;
}

/**
 * Проверяет, действует ли код ТН ВЭД на указанную дату.
 * Если дата не передана — проверяет на текущий момент.
 */
export function isCodeActive(
  tnved: Pick<TnvedCode, 'DBEGIN' | 'DEND'>,
  date: Date = new Date(),
): boolean {
  const d = startOfDay(date);
  if (tnved.DBEGIN && startOfDay(new Date(tnved.DBEGIN)) > d) return false;
  if (tnved.DEND && startOfDay(new Date(tnved.DEND)) < d) return false;
  return true;
}

/**
 * Рассчитывает вероятность классификации товара по коду.
 * Принимает один элемент из результатов searchGoodsGrouped и общее количество.
 * Возвращает долю от 0 до 1.
 */
export function calcProbability(item: Pick<GoodsItem, 'CNT'>, total: number): number {
  if (total <= 0) return 0;
  return item.CNT / total;
}

/** 0.1534 → "15.3%", слишком малая → "< 1%" */
export function formatProbability(probability: number): string {
  const pct = probability * 100;
  if (pct < 1 && pct > 0) return '< 1%';
  return `${pct.toFixed(1)}%`;
}

const SIGN_MAP: Record<string, string> = {
  '>': 'но не менее',
  '<': 'но не более',
};

export function decodeSign(sign: string | undefined): string | null {
  if (!sign) return null;
  return SIGN_MAP[sign] ?? sign;
}

const IMPORT_PRIZNAKS: Priznak[] = [
  Priznak.ImportDuty,
  Priznak.Excise,
  Priznak.Vat,
  Priznak.AdditionalImportDuty,
  Priznak.TempSpecialDuty,
  Priznak.AntidumpingDuty,
  Priznak.CompensatoryDuty,
  Priznak.LicenseImport,
  Priznak.QuotaImport,
  Priznak.Certification,
  Priznak.DualUseImport,
  Priznak.PermitImport,
  Priznak.Marking,
  Priznak.Traceability,
  Priznak.PrefDeveloping,
  Priznak.PrefLeastDeveloped,
  Priznak.CountryImportDuty,
  Priznak.CountryImportBan,
  Priznak.ImportFees,
  Priznak.EaeuImportDuty,
  Priznak.EaeuExcise,
  Priznak.EaeuVat,
  Priznak.Utilization,
];

const EXPORT_PRIZNAKS: Priznak[] = [
  Priznak.ExportDuty,
  Priznak.LicenseExport,
  Priznak.QuotaExport,
  Priznak.DualUseExport,
  Priznak.PermitExport,
  Priznak.StrategicGoods,
  Priznak.ExportFees,
  Priznak.EaeuExportDuty,
  Priznak.CountryExportBan,
];

const DEPOSIT_PRIZNAKS: Priznak[] = [Priznak.Deposit];

export function getPriznaksByOperation(type: OperationType): Priznak[] {
  switch (type) {
    case 'import':
      return IMPORT_PRIZNAKS;
    case 'export':
      return EXPORT_PRIZNAKS;
    case 'deposit':
      return DEPOSIT_PRIZNAKS;
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
