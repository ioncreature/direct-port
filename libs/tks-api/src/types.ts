// --- TNVED API types ---

export interface TnvedRates {
  /** Ставки акцизов */
  AKC?: number;
  AKC2?: number;
  AKC3?: number;
  AKCEDI?: string;
  AKCEDI2?: string;
  AKCEDI3?: string;
  AKCSIGN?: string;
  AKCSIGN2?: string;
  AKCCODE?: string;
  AKC_PR?: number;

  /** Ставки ввозных пошлин */
  IMP?: number;
  IMP2?: number;
  IMP3?: number;
  IMPEDI?: string;
  IMPEDI2?: string;
  IMPEDI3?: string;
  IMPSIGN?: string;
  IMPSIGN2?: string;
  IMP_PR?: number;

  /** Временные пошлины */
  IMPTMP?: number;
  IMPTMP2?: number;
  IMPTMPEDI?: string;
  IMPTMPEDI2?: string;
  IMPTMPSIGN?: string;
  IMPTMP_PR?: number;

  /** Дополнительная пошлина */
  IMPDOP?: number;
  IMPDOP_PR?: number;

  /** Ставки вывозных пошлин */
  EXP?: number;
  EXP2?: number;
  EXP3?: number;
  EXPEDI?: string;
  EXPEDI2?: string;
  EXPEDI3?: string;
  EXPSIGN?: string;
  EXPSIGN2?: string;
  EXP_PR?: number;

  /** Антидемпинговые пошлины */
  IMPDEMP?: number;
  IMPDEMP2?: number;
  IMPDEMPEDI?: string;
  IMPDEMPEDI2?: string;
  IMPDEMPSIGN?: string;
  IMPDEMP_PR?: number;

  /** Компенсационные пошлины */
  IMPCOMP?: number;
  IMPCOMP2?: number;
  IMPCOMPEDI?: string;
  IMPCOMPEDI2?: string;
  IMPCOMPSIGN?: string;
  IMPCOMP_PR?: number;

  /** НДС */
  NDS?: number;
  NDSEDI?: string;
  NDS_PR?: number;

  /** Обеспечение (депозит) */
  DEPOSIT?: number;
  DEPOSITEDI?: string;
  DEPOSIT_PR?: number;

  /** Сборы */
  EXPFEES?: number;
  IMPFEES?: number;
  FEES?: number;
  FEESEDI?: string;
  FEES_PR?: number;

  /** Дополнительные единицы измерения */
  EDI2?: string;
  EDI3?: string;

  /** Лицензирование */
  LICIMP?: number;
  LICEXP?: number;
  LICIMP_PR?: number;
  LICEXP_PR?: number;

  /** Квоты */
  KVOTAIMP?: number;
  KVOTAEXP?: number;
  KVOTAIMP_PR?: number;
  KVOTAEXP_PR?: number;

  /** Специальные товары */
  REG?: number;
  REG_PR?: number;
  DOUBLE?: number;
  DOUBLE_PR?: number;
  MARK?: number;
  MARK_PR?: number;
  STRATEG?: number;
  STRATEG_PR?: number;
  SAFETY?: number;
  SAFETY_PR?: number;

  /** Преференции */
  NOPREF?: number;
  NOPREF_PR?: number;
  PREF92?: number;
  PREF92_PR?: number;

  /** Разрешения и соответствие */
  KLASS?: number;
  KLASS_PR?: number;
  UTIL_PR?: number;
  TRACE?: number;
  TRACE_PR?: number;
  TRACEEDI?: string;
  PENEXP?: number;
  PENEXP_PR?: number;
  PENIMP?: number;
  PENIMP_PR?: number;

  OTHER_PR?: number;
}

export interface TnvedallEntry {
  PRIZNAK?: number;
  CODEMIN?: string;
  CODEMAX?: string;
  MIN?: number;
  MAX?: number;
  MIN2?: number;
  TYPEMIN?: string;
  TYPEMAX?: string;
  TYPEMIN2?: string;
  SIGN?: string;
  SIGN2?: string;
  PREF?: string;
  DOC_N?: string;
  DOC_D?: string;
  NOTE?: string;
  CU?: string;
  DBEGIN?: string;
  DEND?: string;
}

export interface TnvedccEntry {
  PRZ?: number;
  CODE?: string;
  CC?: string;
  PRIM?: number;
  MIN?: number;
  MAX?: number;
  MIN2?: number;
  TYPEMIN?: string;
  TYPEMAX?: string;
  TYPEMIN2?: string;
  SIGN?: string;
  SIGN2?: string;
}

export interface TnvedCode {
  CODE: string;
  KR_NAIM: string;
  DBEGIN?: string;
  DEND?: string;
  PRIM?: string;
  TNVED?: TnvedRates;
  Tnvedall?: Record<string, TnvedallEntry[]>;
  TNVEDCC?: TnvedccEntry[];
}

export interface TnvedVersion {
  ver: string;
}

// --- GOODS API types ---

export interface GoodsItem {
  /** Количество вхождений */
  CNT: number;
  /** Код ТН ВЭД */
  CODE: string;
  /** Наименование */
  KR_NAIM: string;
}

export interface GoodsSearchResponse {
  data: GoodsItem[];
  /** Общее количество результатов */
  hm: number;
  /** Текущая страница */
  page: number;
  /** Количество результатов на странице */
  per_page: number;
}

// --- Справочники ---

export interface OksmtCountry {
  KOD: string;
  ABC2: string;
  ABC3: string;
  ANAIM: string;
  KRNAIM: string;
  NAIM: string;
  KOD_AR: string;
  IMPORT: string;
  S_IMPORT: string;
}

export interface EkArArea {
  KOD: string;
  AKRNAIM: string;
  KRNAIM: string;
  NAIM: string;
  TKS: string;
  KOD_AR: string;
}

// --- Client options ---

export interface TksApiOptions {
  clientKey: string;
  baseUrl?: string;
  timeout?: number;
  /** Включить in-memory кэш для TNVED-запросов (по умолчанию true) */
  cache?: boolean;
  /** TTL кэша в миллисекундах (по умолчанию 1 час) */
  cacheTtl?: number;
  /** Максимальное количество записей в кэше (по умолчанию 1000) */
  cacheMaxSize?: number;
}

// --- Характеристики (priznak) ---

export enum Priznak {
  ExportDuty = 0,
  ImportDuty = 1,
  Excise = 2,
  Vat = 3,
  Deposit = 4,
  PrefDeveloping = 5,
  LicenseExport = 6,
  LicenseImport = 7,
  QuotaExport = 8,
  QuotaImport = 9,
  Certification = 11,
  StrategicGoods = 12,
  DualUseImport = 13,
  PermitImport = 14,
  OtherFeatures = 15,
  TempSpecialDuty = 16,
  AdditionalImportDuty = 17,
  AntidumpingDuty = 19,
  CompensatoryDuty = 20,
  DualUseExport = 21,
  ExportFees = 22,
  ImportFees = 23,
  EaeuImportDuty = 24,
  EaeuExcise = 25,
  EaeuVat = 26,
  PermitExport = 27,
  Marking = 28,
  Utilization = 29,
  CountryImportDuty = 30,
  EaeuExportDuty = 31,
  PrefLeastDeveloped = 32,
  Traceability = 33,
  CountryExportBan = 34,
  CountryImportBan = 35,
}

export type OperationType = 'import' | 'export' | 'deposit';
