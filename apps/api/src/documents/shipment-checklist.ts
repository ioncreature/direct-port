import { formatIsoDate } from '../common/format-date';
import { normalizeOksmtCode } from '../common/oksmt';
import { hasAntidumpingNote, type ProductNote } from '../common/product-notes';
import { sellerPaysCarriage } from '../database/entities/document.entity';
import type { RegulatoryItem, RegulatoryReport } from '../regulatory/interfaces';
import { formatCountryBanWarning } from '../regulatory/regulatory-format';
import type {
  ChecklistConfidence,
  ChecklistTiming,
} from '../regulatory/curated/interfaces';
import {
  BASE_PACKAGE,
  FREIGHT_DOCUMENTS,
  INSURANCE_DOCUMENTS,
  type ShipmentDocumentSpec,
} from '../regulatory/curated/base-package';
import { VALUE_DOSSIER } from '../regulatory/curated/value-dossier';
import {
  DOCUMENT_TIMING,
  type DocumentTimingKey,
} from '../regulatory/curated/document-timing';
import {
  G44_CONFORMITY_CODES,
  G44_IMPORT_LICENSE,
  G44_ORIGIN_CERTIFICATE,
  G44_UTILIZATION_FEE,
} from '../regulatory/curated/g44-codes';
import { MARKING_WAVES, matchMarkingWaves, type MarkingWave } from '../regulatory/curated/marking-waves';
import { localizedSpecTitle, translateTemplateTitle } from './checklist-translations';

/**
 * «Документы к поставке» — связный чек-лист документов, которые клиенту нужно
 * собрать к конкретной поставке: базовый пакет (ст. 108 ТК ЕАЭС), условные
 * требования по кодам ТН ВЭД строк (из regulatoryReport/TKS) и «стоимостное
 * досье» на случай запроса таможни (ст. 325 ТК ЕАЭС).
 *
 * Главное свойство — timing: чек-лист говорит не только «что», но и «когда»
 * (нотификацию ФСБ проверять до заказа, экспортную декларацию Китая запрашивать
 * при отгрузке, коды «Честного знака» наносить на фабрике).
 *
 * Три источника с разной уверенностью:
 * - base    — безусловный базовый пакет (ст. 108 + классификатор гр. 44);
 * - tks     — меры из regulatoryReport строк; уверенность из matchPrecision
 *             (exact → confirmed, narrow/broad → «проверьте»); нотификация ФСБ —
 *             всегда «проверьте» (по коду не определяется);
 * - curated — то, чего в TKS нет: волны «Честного знака» с датами, сертификат
 *             происхождения при антидемпинге, стоимостное досье.
 *
 * Чек-лист нигде не хранится: генерируется на лету из resultData (endpoint и
 * Excel), поэтому пересчёт документа автоматически даёт актуальный чек-лист.
 */

/** Строка resultData в полях, нужных чек-листу. Все поля читаются толерантно. */
export interface ChecklistRowInput {
  tnVedCode?: string;
  /** Страна происхождения строки (OKSMT), если отличается от страны документа. */
  countryOfOrigin?: string | null;
  notes?: ProductNote[];
  regulatoryReport?: RegulatoryReport | null;
}

export interface ChecklistItem {
  title: string;
  /** Перевод заголовка для language=en/zh (null — язык ru или перевода нет). */
  titleLocalized: string | null;
  /** Код вида документа по классификатору гр. 44 (null — кода нет). */
  g44Code: string | null;
  /** Правовое основание пункта (акт + пункт или запись справочника). */
  basis: string;
  timing: ChecklistTiming;
  scope: 'shipment' | 'rows';
  /** 1-based номера строк листа «Результат» (пустой при scope='shipment'). */
  rowNumbers: number[];
  source: 'base' | 'curated' | 'tks';
  confidence: ChecklistConfidence;
  /** Пояснение: кто оформляет, сколько занимает, почему именно сейчас. */
  details: string | null;
}

export interface ShipmentChecklist {
  /** Пункты, отсортированные по timing → confidence → title. */
  items: ChecklistItem[];
  /** Предупреждения уровня поставки (страновые запреты и т. п.). */
  warnings: string[];
}

export const TIMING_ORDER: ChecklistTiming[] = [
  'before_order',
  'before_shipment',
  'for_declaration',
  'on_request',
];

export const TIMING_LABELS: Record<ChecklistTiming, string> = {
  before_order: 'До заказа / производства',
  before_shipment: 'К отгрузке',
  for_declaration: 'К подаче декларации',
  on_request: 'На случай запроса таможни',
};

export const CONFIDENCE_LABELS: Record<ChecklistConfidence, string> = {
  confirmed: 'Требуется',
  probable: 'Вероятно требуется',
  check: 'Проверьте',
};

const CONFIDENCE_RANK: Record<ChecklistConfidence, number> = {
  confirmed: 0,
  probable: 1,
  check: 2,
};

const PRECISION_RANK: Record<string, number> = { exact: 0, narrow: 1, broad: 2 };

/** Внутренний аккумулятор пункта до финальной сборки. */
interface PendingItem {
  item: Omit<ChecklistItem, 'rowNumbers' | 'confidence'>;
  rowSet: Set<number>;
  /** Лучшая точность совпадения по строкам (0=exact): мера, точно применимая хотя бы
   *  к одной строке, попадает в чек-лист уверенно — перечень строк уточняет ДТ-лист. */
  bestPrecision: number;
  /** Фиксированная уверенность (нотификация/dual-use/волны ЧЗ), перекрывает precision. */
  forcedConfidence: ChecklistConfidence | null;
  /** Дополнительные строки details (даты волн ЧЗ). */
  extraDetails: Set<string>;
}

const FORM_TITLE: Record<string, string> = {
  certificate: 'Сертификат соответствия',
  declaration: 'Декларация о соответствии',
  state_registration: 'Свидетельство о государственной регистрации (СГР)',
  notification: 'Нотификация ФСБ (шифровальные средства)',
};

const FORM_TIMING_KEY: Record<string, DocumentTimingKey> = {
  certificate: 'tr_certificate',
  declaration: 'tr_declaration',
  state_registration: 'state_registration',
  notification: 'fsb_notification',
};

function tksBasis(item: RegulatoryItem): string {
  return item.regulation
    ? `${item.regulation} (запись справочника ТН ВЭД)`
    : 'запись справочника ТН ВЭД (TKS)';
}

export function buildShipmentChecklist(opts: {
  rows: ChecklistRowInput[];
  /** Страна происхождения документа (OKSMT) — для строк без собственной страны. */
  docCountryOfOrigin: string | null;
  incoterms: string | null;
  freightCost: number | null;
  language: string | null;
  /** «Сегодня» для сравнения дат волн маркировки; параметр — для тестируемости. */
  now?: Date;
  /** Переопределение волн маркировки (для тестов). */
  markingWaves?: MarkingWave[];
}): ShipmentChecklist {
  const { rows, incoterms, freightCost, language } = opts;
  const now = opts.now ?? new Date();
  const waves = opts.markingWaves ?? MARKING_WAVES;
  const docCountry = normalizeOksmtCode(opts.docCountryOfOrigin);

  const items: ChecklistItem[] = [];

  const staticItem = (
    spec: ShipmentDocumentSpec,
    source: ChecklistItem['source'],
    confidence?: ChecklistConfidence,
    extraDetails?: string,
  ): ChecklistItem => ({
    title: spec.title,
    titleLocalized: localizedSpecTitle(spec, language),
    g44Code: spec.g44Code,
    basis: spec.basis,
    timing: spec.timing,
    scope: 'shipment',
    rowNumbers: [],
    source,
    confidence: confidence ?? spec.confidence ?? 'confirmed',
    details: extraDetails ? `${spec.details} ${extraDetails}` : spec.details,
  });

  // 1. Базовый пакет — безусловно.
  for (const spec of BASE_PACKAGE) items.push(staticItem(spec, 'base'));

  // 2. Документы структуры ТС по Инкотермс/фрахту. При CFR…DDP без заданного фрахта
  //    перевозку оплачивает продавец — документы перевозки покупателю не нужны.
  const freightInPrice = incoterms ? sellerPaysCarriage(incoterms) : null;
  const hasFreight = freightCost != null && freightCost > 0;
  if (hasFreight || freightInPrice === false) {
    items.push(staticItem(FREIGHT_DOCUMENTS, 'base'));
  } else if (freightInPrice === null) {
    items.push(
      staticItem(
        FREIGHT_DOCUMENTS,
        'base',
        'check',
        'Актуально, если перевозку до границы ЕАЭС организует покупатель (EXW/FCA/FAS/FOB).',
      ),
    );
  }
  if (incoterms === 'CIF' || incoterms === 'CIP') {
    items.push(staticItem(INSURANCE_DOCUMENTS, 'base'));
  }

  // 3. Стоимостное досье — всегда: запрос по ст. 325 может получить любая поставка,
  //    порога «рисковой стоимости» в праве нет.
  for (const spec of VALUE_DOSSIER) items.push(staticItem(spec, 'curated', 'probable'));

  // 4. Меры из regulatoryReport строк (TKS) — с дедупликацией по мере.
  const pending = new Map<string, PendingItem>();

  const accumulate = (
    key: string,
    rowNumber: number,
    precision: string | undefined,
    build: () => PendingItem['item'],
    forcedConfidence: ChecklistConfidence | null = null,
  ): void => {
    let entry = pending.get(key);
    if (!entry) {
      entry = {
        item: build(),
        rowSet: new Set(),
        bestPrecision: Number.MAX_SAFE_INTEGER,
        forcedConfidence,
        extraDetails: new Set(),
      };
      pending.set(key, entry);
    }
    entry.rowSet.add(rowNumber);
    entry.bestPrecision = Math.min(entry.bestPrecision, PRECISION_RANK[precision ?? ''] ?? 2);
  };

  /** Инвариантная часть TKS-пункта: timing/details из правила, basis из записи TKS. */
  const tksItem = (
    src: RegulatoryItem,
    timingKey: DocumentTimingKey,
    title: string,
    g44Code: string | null,
    params?: { reg?: string | null },
  ): PendingItem['item'] => {
    const rule = DOCUMENT_TIMING[timingKey];
    return {
      title,
      titleLocalized: translateTemplateTitle(timingKey, language, params),
      g44Code,
      basis: tksBasis(src),
      timing: rule.timing,
      scope: 'rows',
      source: 'tks',
      details: rule.details,
    };
  };

  // Страновые запреты копятся по мере со списком строк — иначе документ из сотен
  // строк одного запрещённого кода дал бы сотни одинаковых предупреждений.
  const banWarnings = new Map<string, { text: string; rowNumbers: number[] }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const report = row.regulatoryReport;
    if (!report) continue;

    for (const cert of report.certifications ?? []) {
      const timingKey = FORM_TIMING_KEY[cert.form] ?? 'conformity_generic';
      const baseTitle = FORM_TITLE[cert.form] ?? 'Подтверждение соответствия';
      const title = cert.regulation ? `${baseTitle} ${cert.regulation}` : baseTitle;
      accumulate(
        `conformity|${title}`,
        rowNumber,
        cert.matchPrecision,
        () =>
          tksItem(cert, timingKey, title, G44_CONFORMITY_CODES[cert.form] ?? null, {
            reg: cert.regulation,
          }),
        // Нотификация: применимость зависит от функционала товара (наличия
        // шифрования), по коду ТН ВЭД не определяется — всегда «проверьте».
        cert.form === 'notification' ? 'check' : null,
      );
    }

    for (const lic of report.licenses ?? []) {
      if (lic.category !== 'license_import') continue;
      const title = lic.authority ? `Лицензия на импорт (${lic.authority})` : 'Лицензия на импорт';
      accumulate(`license|${title}`, rowNumber, lic.matchPrecision, () =>
        tksItem(lic, 'import_license', title, G44_IMPORT_LICENSE),
      );
    }

    for (const permit of report.permits ?? []) {
      if (permit.category !== 'permit_import') continue;
      const title = permit.authority
        ? `Разрешение на ввоз (${permit.authority})`
        : 'Разрешение на ввоз';
      accumulate(`permit|${title}`, rowNumber, permit.matchPrecision, () =>
        tksItem(permit, 'import_permit', title, null),
      );
    }

    for (const fee of report.utilizationFee ?? []) {
      accumulate(`utilization`, rowNumber, fee.matchPrecision, () =>
        tksItem(fee, 'utilization_fee', 'Расчёт утилизационного сбора', G44_UTILIZATION_FEE),
      );
    }

    for (const mark of report.marking ?? []) {
      accumulate(`marking`, rowNumber, mark.matchPrecision, () =>
        tksItem(mark, 'marking', 'Маркировка «Честный знак»', null),
      );
    }

    for (const dual of report.strategicAndDualUse ?? []) {
      if (dual.category === 'dual_use_export') continue;
      accumulate(
        `dual_use`,
        rowNumber,
        dual.matchPrecision,
        () => tksItem(dual, 'dual_use', 'Экспортный контроль / товары двойного назначения', null),
        'check',
      );
    }

    const rowCountry = normalizeOksmtCode(row.countryOfOrigin) ?? docCountry;
    for (const ban of report.countryRestrictions ?? []) {
      if (ban.category !== 'country_import_ban') continue;
      if (rowCountry && ban.countryCode && ban.countryCode !== rowCountry) continue;
      const text = formatCountryBanWarning(ban);
      let entry = banWarnings.get(text);
      if (!entry) {
        entry = { text, rowNumbers: [] };
        banWarnings.set(text, entry);
      }
      entry.rowNumbers.push(rowNumber);
    }
  }

  // 5. Волны «Честного знака» (curated): TKS молчит → отдельный пункт с датой;
  //    TKS уже показывает маркировку → дата волны дополняет его details.
  const tksMarking = pending.get('marking');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const code = String(row.tnVedCode ?? '').trim();
    if (!code) continue;
    for (const wave of matchMarkingWaves(code, waves)) {
      const dateRu = formatIsoDate(wave.mandatoryFrom);
      if (tksMarking?.rowSet.has(rowNumber)) {
        tksMarking.extraDetails.add(
          `${wave.group}: маркировка обязательна с ${dateRu} (${wave.basis}).${wave.note ? ` ${wave.note}` : ''}`,
        );
        continue;
      }
      const isFuture = new Date(wave.mandatoryFrom) > now;
      const rule = DOCUMENT_TIMING.marking;
      accumulate(
        `marking_wave|${wave.group}`,
        rowNumber,
        wave.partial ? 'broad' : 'narrow',
        () => ({
          title: `Маркировка «Честный знак» — ${wave.group}`,
          titleLocalized: translateTemplateTitle('marking_wave', language, { date: dateRu }),
          g44Code: null,
          basis: wave.basis,
          timing: rule.timing,
          scope: 'rows',
          source: 'curated',
          details:
            (isFuture
              ? `Станет обязательной с ${dateRu} — при поставке после этой даты коды нужно нанести до выпуска. `
              : `Обязательна с ${dateRu}, при этом запись справочника ТН ВЭД маркировку не показывает — сверьте товар с перечнем группы. `) +
            rule.details +
            (wave.note ? ` ${wave.note}` : ''),
        }),
        wave.partial ? 'check' : 'probable',
      );
    }
  }

  // 6. Антидемпинг/компенсационные меры (сигнал из notes расчёта) →
  //    сертификат происхождения.
  const originRule = DOCUMENT_TIMING.origin_certificate;
  for (let i = 0; i < rows.length; i++) {
    if (!hasAntidumpingNote(rows[i].notes)) continue;
    accumulate(
      'origin_certificate',
      i + 1,
      'exact',
      () => ({
        title: 'Сертификат о происхождении товара (непреференциальный)',
        titleLocalized: translateTemplateTitle('origin_certificate', language),
        g44Code: G44_ORIGIN_CERTIFICATE,
        basis: `антидемпинговая/компенсационная мера по строкам расчёта; ${originRule.basis}`,
        timing: originRule.timing,
        scope: 'rows',
        source: 'curated',
        details: originRule.details,
      }),
    );
  }

  // Финализация накопленных пунктов: уверенность из точности совпадения.
  for (const entry of pending.values()) {
    const confidence: ChecklistConfidence =
      entry.forcedConfidence ?? (entry.bestPrecision === 0 ? 'confirmed' : 'check');
    const extra = [...entry.extraDetails].join(' ');
    items.push({
      ...entry.item,
      details: extra ? `${entry.item.details ?? ''} ${extra}`.trim() : entry.item.details,
      rowNumbers: [...entry.rowSet].sort((a, b) => a - b),
      confidence,
    });
  }

  items.sort((a, b) => {
    const timing = TIMING_ORDER.indexOf(a.timing) - TIMING_ORDER.indexOf(b.timing);
    if (timing !== 0) return timing;
    const conf = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (conf !== 0) return conf;
    return a.title.localeCompare(b.title, 'ru');
  });

  const warnings = [...banWarnings.values()].map(
    (w) =>
      `${w.text} — ${w.rowNumbers.length > 1 ? 'строки' : 'строка'} ${w.rowNumbers.join(', ')}`,
  );

  return { items, warnings };
}
