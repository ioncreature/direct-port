import type { TnvedCode } from '@direct-port/tks-api';
import { normalizeImpediUnit } from '../common/normalize-impedi';
import { DEFAULT_VAT_RATE } from '../common/vat';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductNote } from '../common/product-notes';
import type {
  ClassifiedProduct,
  ClaudeSelection,
  CodeCandidate,
  ProductRow,
  TksCandidate,
} from './classifier.service';

// Жёсткий enum, чтобы бот мог сматчить категорию с локализованной подсказкой.
// Добавляя категорию, добавь и ключ `row-clarify-missing-{key}` во все .ftl-локали бота.
export const MISSING_DATA_CATEGORIES = [
  'material',
  'composition',
  'purpose',
  'dimensions',
  'electrical',
  'age_group',
  'form_factor',
  'origin',
  'application',
] as const;

export type MissingDataCategory = (typeof MISSING_DATA_CATEGORIES)[number];

export function assembleResults(
  products: ProductRow[],
  candidatesByProduct: TksCandidate[][],
  selections: (ClaudeSelection | null)[],
  tnvedByCode: Map<string, TnvedCode>,
  language: string | undefined,
  confidenceThreshold: number,
): ClassifiedProduct[] {
  return products.map((product, i) => {
    const sel = selections[i];
    const candidates = candidatesByProduct[i] ?? [];
    const bestTks = candidates[0] ?? null;

    // Priority: Claude selection > best TKS candidate > unmatched
    const chosenCode = sel?.tnVedCode ?? bestTks?.code ?? '';
    const tnved = chosenCode ? tnvedByCode.get(chosenCode) : undefined;

    if (!chosenCode || !tnved) {
      return unmatched(product, sel, candidates);
    }

    const rates = tnved.TNVED ?? {};
    const notes: ProductNote[] = [...(product.notes ?? [])];

    const confidence = sel?.confidence ?? bestTks?.confidence ?? 0;
    const verified = sel != null;

    if (!verified) {
      notes.push({
        stage: 'classify',
        severity: 'warning',
        field: 'code',
        message:
          'AI-классификация недоступна, код выбран только по справочнику TKS. Рекомендуется проверка.',
        messageLocalized: getStaticNoteTranslation('verification-disabled', language),
      });
    } else if (confidence < confidenceThreshold) {
      notes.push({
        stage: 'classify',
        severity: 'warning',
        field: 'code',
        message: `Код ${chosenCode} выбран с невысокой уверенностью (${confidence.toFixed(2)}). ${sel.comment}`,
        messageLocalized: sel.comment_localized
          ? `Code ${chosenCode} selected with low confidence (${confidence.toFixed(2)}). ${sel.comment_localized}`
          : undefined,
      });
    } else if (sel.comment) {
      notes.push({
        stage: 'classify',
        severity: 'info',
        field: 'code',
        message: `Классификация: ${sel.comment}`,
        messageLocalized: sel.comment_localized
          ? `Classification: ${sel.comment_localized}`
          : undefined,
      });
    }

    const suggestedCode = sel && !sel.fromCandidates ? sel.tnVedCode : null;
    const candidateCodes = buildCandidateCodes(
      sel,
      tnved,
      confidence,
      confidenceThreshold,
      tnvedByCode,
    );

    const missingDataCategories = normalizeMissingDataCategories(
      sel?.missingDataCategories,
      confidence,
      confidenceThreshold,
    );

    return {
      ...product,
      tnVedCode: tnved.CODE,
      tnVedDescription: tnved.KR_NAIM,
      dutyRate: rates.IMP ?? 0,
      dutyRateUnit: normalizeImpediUnit(rates.IMPEDI),
      dutySign: rates.IMPSIGN ?? null,
      dutyMin: rates.IMP2 ?? null,
      dutyMinUnit: normalizeImpediUnit(rates.IMPEDI2),
      vatRate: rates.NDS ?? DEFAULT_VAT_RATE,
      exciseRate: rates.AKC ?? 0,
      matchConfidence: confidence,
      matched: true,
      tnvedRaw: tnved,
      verified,
      suggestedCode,
      verificationComment: sel?.comment ?? '',
      notes,
      ...(candidateCodes ? { candidateCodes } : {}),
      ...(missingDataCategories.length ? { missingDataCategories } : {}),
    };
  });
}

export function buildRateFields(tnved: TnvedCode): {
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  dutyRateUnit: string | null;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
} {
  const rates = tnved.TNVED;
  return {
    tnVedCode: tnved.CODE,
    tnVedDescription: tnved.KR_NAIM,
    dutyRate: rates?.IMP ?? 0,
    dutyRateUnit: normalizeImpediUnit(rates?.IMPEDI),
    dutySign: rates?.IMPSIGN ?? null,
    dutyMin: rates?.IMP2 ?? null,
    dutyMinUnit: normalizeImpediUnit(rates?.IMPEDI2),
    vatRate: rates?.NDS ?? DEFAULT_VAT_RATE,
    exciseRate: rates?.AKC ?? 0,
  };
}

function unmatched(
  product: ProductRow,
  sel: ClaudeSelection | null,
  candidates: TksCandidate[],
): ClassifiedProduct {
  const reason =
    candidates.length === 0
      ? 'TKS не вернул кандидатов, AI не смог предложить код'
      : sel
        ? `AI предложил код ${sel.tnVedCode}, но он не найден в справочнике`
        : 'Не удалось определить код ТН ВЭД';

  return {
    ...product,
    tnVedCode: '',
    tnVedDescription: 'Не найден',
    dutyRate: 0,
    dutyRateUnit: null,
    dutySign: null,
    dutyMin: null,
    dutyMinUnit: null,
    vatRate: DEFAULT_VAT_RATE,
    exciseRate: 0,
    matchConfidence: 0,
    matched: false,
    tnvedRaw: undefined,
    verified: false,
    suggestedCode: sel?.tnVedCode ?? null,
    verificationComment: sel?.comment ?? reason,
    notes: [
      ...(product.notes ?? []),
      {
        stage: 'classify',
        severity: 'blocker',
        field: 'code',
        message: `${reason}. Без кода ТН ВЭД расчёт пошлины и НДС невозможен.`,
      },
    ],
  };
}

/**
 * Собирает список вариантов кода (выбранный + альтернативы Claude) с подгруженными
 * ставками, до 3 штук. Возвращает undefined для уверенных классификаций без альтернатив —
 * админка тогда не показывает блок «Альтернативные коды» (но инпут «Свой код» доступен всегда).
 */
function buildCandidateCodes(
  sel: ClaudeSelection | null,
  chosenTnved: TnvedCode,
  confidence: number,
  confidenceThreshold: number,
  tnvedByCode: Map<string, TnvedCode>,
): CodeCandidate[] | undefined {
  const alternatives = sel?.alternatives ?? [];
  const isLowConfidence = confidence < confidenceThreshold;
  if (alternatives.length === 0 && !isLowConfidence) return undefined;

  const chosenRates = chosenTnved.TNVED ?? {};
  const list: CodeCandidate[] = [
    {
      code: chosenTnved.CODE,
      description: chosenTnved.KR_NAIM,
      dutyRate: chosenRates.IMP ?? 0,
      dutyRateUnit: normalizeImpediUnit(chosenRates.IMPEDI),
      vatRate: chosenRates.NDS ?? DEFAULT_VAT_RATE,
      exciseRate: chosenRates.AKC ?? 0,
      confidence,
      reasoning: sel?.comment ?? '',
      ...(sel?.comment_localized ? { reasoningLocalized: sel.comment_localized } : {}),
    },
  ];

  for (const alt of alternatives) {
    const altTnved = tnvedByCode.get(alt.tnVedCode);
    if (!altTnved || altTnved.CODE === chosenTnved.CODE) continue;
    const altRates = altTnved.TNVED ?? {};
    list.push({
      code: altTnved.CODE,
      description: altTnved.KR_NAIM,
      dutyRate: altRates.IMP ?? 0,
      dutyRateUnit: normalizeImpediUnit(altRates.IMPEDI),
      vatRate: altRates.NDS ?? DEFAULT_VAT_RATE,
      exciseRate: altRates.AKC ?? 0,
      confidence: alt.confidence,
      reasoning: alt.reasoning,
      ...(alt.reasoning_localized ? { reasoningLocalized: alt.reasoning_localized } : {}),
    });
  }

  return list.slice(0, 3);
}

/**
 * Фильтрует категории, которые Claude вернул, по жёсткому enum (защита от галлюцинаций),
 * и обнуляет их для confidence ≥ threshold — на уверенных строках они только мешают
 * (пользователю не нужно «уточнять» то, что уже корректно классифицировано).
 */
function normalizeMissingDataCategories(
  raw: string[] | undefined,
  confidence: number,
  threshold: number,
): MissingDataCategory[] {
  if (!raw || raw.length === 0) return [];
  if (confidence >= threshold) return [];
  const allowed = new Set<string>(MISSING_DATA_CATEGORIES);
  const filtered = raw.filter((c): c is MissingDataCategory => allowed.has(c));
  // dedup, ограничиваем 3 — bot всё равно выдаст не больше 3 в подсказке.
  return [...new Set(filtered)].slice(0, 3);
}
