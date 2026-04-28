/**
 * Категории мер нетарифного регулирования. Каждая строится из соответствующего PRIZNAK
 * блока TNVEDALL справочника TKS — см. enum `Priznak` в @direct-port/tks-api.
 */
export type RegulatoryCategory =
  | 'certification'       // PRIZNAK=11
  | 'permit_import'       // PRIZNAK=14
  | 'permit_export'       // PRIZNAK=27
  | 'license_import'      // PRIZNAK=7
  | 'license_export'      // PRIZNAK=6
  | 'marking'             // PRIZNAK=28
  | 'traceability'        // PRIZNAK=33
  | 'utilization'         // PRIZNAK=29
  | 'strategic'           // PRIZNAK=12
  | 'dual_use_import'     // PRIZNAK=13
  | 'dual_use_export'     // PRIZNAK=21
  | 'country_import_ban'  // PRIZNAK=35
  | 'country_export_ban'  // PRIZNAK=34
  | 'other';              // PRIZNAK=15 и неклассифицированные

/** Форма документа/оценки соответствия, извлечённая из текста NOTE. */
export type AssessmentForm =
  | 'declaration'         // декларация о соответствии (ДС)
  | 'certificate'         // сертификат соответствия (СС)
  | 'state_registration'  // свидетельство о государственной регистрации (СГР)
  | 'notification'        // нотификация (например, криптография ФСБ)
  | 'permit'              // разрешение / заключение
  | 'license'             // лицензия Минпромторга/иного органа
  | 'fee'                 // сбор/платёж (утилизационный, экологический)
  | 'unknown';

export interface RegulatoryDocumentRef {
  /** Номер документа из DOC_N (может содержать буквенные префиксы, например "БН_392"). */
  number: string;
  /** ISO YYYY-MM-DD из DOC_D или null. */
  date: string | null;
}

/**
 * Точность совпадения меры с конкретным кодом товара. TKS возвращает меру с диапазоном
 * CODEMIN..CODEMAX, и для длинных кодов (≥8 знаков) её можно считать применимой точно;
 * для короткого префикса (например, "84") — это «возможно применимо», что нужно отметить
 * в UI отдельным бейджем, чтобы клиент не получил ложноположительных требований.
 */
export type MatchPrecision = 'exact' | 'narrow' | 'broad';

export interface RegulatoryItem {
  category: RegulatoryCategory;
  priznak: number;
  /** Короткий заголовок для UI (одна строка). */
  title: string;
  /** Информативная сводка: 2–4 предложения, что требуется, кто требует, на основании чего. */
  summary: string;
  /** Идентификатор технического регламента: "ТР ТС 020/2011" или "ТР ЕАЭС 037/2016". */
  regulation: string | null;
  /** Полное название регламента (текст из кавычек), если найдено в NOTE. */
  regulationTitle: string | null;
  form: AssessmentForm;
  /** Ведомство-регулятор: Минпромторг, Роспотребнадзор, Минцифры и т. п. */
  authority: string | null;
  documentRef: RegulatoryDocumentRef | null;
  /** Дата вступления записи в силу (ISO YYYY-MM-DD). Может быть в будущем — мера ещё не работает. */
  validFrom: string | null;
  /** Дата окончания действия (ISO YYYY-MM-DD). null = бессрочно. */
  validTo: string | null;
  matchPrecision: MatchPrecision;
  codeRange: { min: string; max: string | null };
  /** OKSMT-код (3 цифры). Заполняется только для запретов/санкций по стране (PRIZNAK=34/35). */
  countryCode: string | null;
  countryName: string | null;
  /** Сырые числовые поля из TKS-записи: для утильсбора это ставка/норматив. Не интерпретируем. */
  values: { min: number | null; max: number | null; unit: string | null };
  rawNote: string;
}

/**
 * Сгруппированный отчёт по разрешительным мерам для одного кода ТН ВЭД.
 * Группировка для UI: похожие категории объединены, чтобы не плодить пустые секции.
 */
export interface RegulatoryReport {
  certifications: RegulatoryItem[];
  permits: RegulatoryItem[];                // permit_import + permit_export
  licenses: RegulatoryItem[];               // license_import + license_export
  marking: RegulatoryItem[];
  traceability: RegulatoryItem[];
  utilizationFee: RegulatoryItem[];
  strategicAndDualUse: RegulatoryItem[];    // strategic + dual_use_*
  countryRestrictions: RegulatoryItem[];    // country_import_ban + country_export_ban
  other: RegulatoryItem[];
  totalCount: number;
}
