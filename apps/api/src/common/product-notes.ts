/**
 * Сквозные заметки, которые каждый этап pipeline может оставить на товаре.
 * Назначение — прозрачно довести до пользователя (декларанта или клиента в боте),
 * что в расчёте не сходится, какое уточнение требуется и почему именно такая цифра.
 *
 * Правила:
 * - Заметки только добавляются, никогда не стираются
 * - severity='blocker' означает, что без уточнения расчёт неполный (например, не хватает площади для специфической пошлины)
 * - severity='warning' — расчёт выполнен, но есть сомнения (низкий confidence классификатора, Claude предложил альтернативный код, и т.п.)
 * - severity='info' — нейтральная подсказка, не влияет на корректность
 */

import { deliversInCountry, sellerPaysCarriage } from '../database/entities/document.entity';

export type ProductNoteStage = 'parse' | 'classify' | 'verify' | 'interpret' | 'calculate';

export type ProductNoteSeverity = 'info' | 'warning' | 'blocker';

export interface ProductNote {
  stage: ProductNoteStage;
  severity: ProductNoteSeverity;
  /** Человекочитаемое сообщение на русском. Показывается в Excel и в админке. */
  message: string;
  /** Сообщение на языке пользователя (если document.language !== 'ru'). */
  messageLocalized?: string;
  /** Какое поле затронуто: 'duty' | 'vat' | 'excise' | 'code' | 'dimensions' | ... */
  field?: string;
}

/**
 * Агрегированный статус расчёта, выводимый из notes.
 * Заменяет предыдущий verificationStatus, который показывал только качество матча TKS.
 */
export type CalculationStatus = 'exact' | 'partial' | 'needs_info' | 'error';

/**
 * Заметка о том, что заданный у документа фрахт НЕ вошёл в расчёт (нет курса валюты
 * фрахта к валюте документа). Без неё занижение таможенной стоимости видно только
 * в логах — ни оператор, ни клиент не узнают, что налоги посчитаны без доставки.
 */
export function freightIgnoredWarningNote(cost: number, currency: string): ProductNote {
  return {
    stage: 'calculate',
    severity: 'warning',
    field: 'freight',
    message:
      `Фрахт ${cost} ${currency} не включён в расчёт: курс валюты фрахта к валюте ` +
      `документа недоступен. Таможенная стоимость, пошлина и НДС могут быть занижены — ` +
      `выполните «Пересчитать» позже.`,
  };
}

/**
 * Строка с таким calculationStatus посчитана не полностью (нет кода — error,
 * не хватило данных для точной пошлины — needs_info). Документ с такими строками
 * должен получать PROCESSED_WITH_ERRORS, а не «чистый» PROCESSED: итоговая сумма
 * в Excel занижена относительно реальной декларации. Единый источник для
 * биллинга (списание за успешные позиции) и SQL-агрегаций дашборда.
 */
export const INCOMPLETE_CALCULATION_STATUSES = ['error', 'needs_info'] as const;

export function isIncompleteCalculationStatus(status: unknown): boolean {
  return (INCOMPLETE_CALCULATION_STATUSES as readonly unknown[]).includes(status);
}

/** По строке применена антидемпинговая/компенсационная мера (сигнал этапа расчёта). */
export function hasAntidumpingNote(notes: ProductNote[] | undefined): boolean {
  return (notes ?? []).some((n) => n.field === 'antidumping' || n.field === 'compensatory');
}

/**
 * Контроль структуры таможенной стоимости по условиям поставки Инкотермс:
 * - CFR/CIF/CPT/CIP: перевозка оплачена продавцом и обычно уже в цене — дополнительно
 *   заданный фрахт задваивает таможенную стоимость;
 * - EXW/FCA/FAS/FOB: перевозка до границы НЕ в цене — без заданного фрахта таможенная
 *   стоимость и налоги занижены;
 * - DAP/DPU/DDP без фрахта: цена включает перевозку по РФ после границы (а у DDP — ещё
 *   ввозные пошлины/НДС), которые в ТС не входят и инструментом не вычитаются — стоимость
 *   завышена.
 * null — условий нет или комбинация корректна (заметка не нужна).
 */
export function incotermsFreightNote(doc: {
  incoterms: string | null;
  freightCost: number | null;
}): ProductNote | null {
  if (!doc.incoterms) return null;
  const freightInPrice = sellerPaysCarriage(doc.incoterms);
  const hasFreight = doc.freightCost != null && doc.freightCost > 0;

  if (freightInPrice && hasFreight) {
    return {
      stage: 'calculate',
      severity: 'warning',
      field: 'freight',
      message:
        `Условия поставки ${doc.incoterms}: перевозка оплачена продавцом и обычно уже включена ` +
        `в цену товара, а у документа дополнительно задан фрахт — проверьте, нет ли двойного ` +
        `счёта в таможенной стоимости. Лишний фрахт сбрасывается пересчётом с freightCost = 0.`,
    };
  }
  if (!freightInPrice && !hasFreight) {
    return {
      stage: 'calculate',
      severity: 'warning',
      field: 'freight',
      message:
        `Условия поставки ${doc.incoterms}: доставка до границы ЕАЭС не входит в цену товара, ` +
        `а фрахт у документа не задан — таможенная стоимость, пошлина и НДС занижены. ` +
        `Укажите фрахт и нажмите «Пересчитать».`,
    };
  }
  if (freightInPrice && !hasFreight && deliversInCountry(doc.incoterms)) {
    const isDdp = doc.incoterms === 'DDP';
    return {
      stage: 'calculate',
      severity: 'warning',
      field: 'freight',
      message:
        `Условия поставки ${doc.incoterms}: цена включает доставку по территории РФ после ` +
        `границы` +
        (isDdp ? ', а также ввозные пошлины и налоги (в т. ч. НДС)' : '') +
        `. Эти суммы в таможенную стоимость не входят (п. 2 ст. 40 ТК ЕАЭС), но здесь она ` +
        `взята равной цене — таможенная стоимость, пошлина и НДС завышены. Вычтите их вручную ` +
        `при документальном подтверждении.`,
    };
  }
  return null;
}

export function defaultCountryWarningNote(): ProductNote {
  return {
    stage: 'calculate',
    severity: 'warning',
    field: 'country',
    message:
      'Страна происхождения не определена по документу — применён Китай по умолчанию. ' +
      'Если страна другая, измените её на странице документа и нажмите «Пересчитать».',
  };
}

/**
 * Вычисление итогового статуса расчёта из списка заметок.
 * - error  — если есть blocker с field='code' (не смогли классифицировать)
 * - needs_info — если есть blocker (не хватает dimensions, не смогли посчитать пошлину)
 * - partial — если есть warning
 * - exact — иначе
 */
export function resolveCalculationStatus(notes: ProductNote[]): CalculationStatus {
  let hasBlocker = false;
  let hasWarning = false;
  let hasCodeBlocker = false;

  for (const note of notes) {
    if (note.severity === 'blocker') {
      hasBlocker = true;
      if (note.field === 'code') {
        hasCodeBlocker = true;
      }
    } else if (note.severity === 'warning') {
      hasWarning = true;
    }
  }

  if (hasCodeBlocker) return 'error';
  if (hasBlocker) return 'needs_info';
  if (hasWarning) return 'partial';
  return 'exact';
}
