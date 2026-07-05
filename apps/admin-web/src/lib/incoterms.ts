import type { Incoterms } from './types';

/**
 * Справочные данные по базисам поставки Incoterms® 2020 для UI админки.
 *
 * Формулировки выверены аудитом на соответствие правилам ICC 2020 и практике
 * определения таможенной стоимости при импорте в РФ (ст. 39–40 ТК ЕАЭС).
 *
 * ВАЖНО: `freightInPrice` зеркалит массив `INCOTERMS_FREIGHT_IN_PRICE`
 * (apps/api/src/database/entities/document.entity.ts) — это тот же признак
 * «перевозку оплачивает продавец», по которому сервер строит предупреждения.
 * При изменении набора терминов держать оба списка в синхроне. Долгосрочно эти
 * домен-данные стоит вынести в общий `@direct-port/common` (пакет уже подключён к
 * обоим приложениям).
 */
export interface IncotermsInfo {
  /** Общепринятое русское название базиса. */
  nameRu: string;
  /** Официальное английское название. */
  nameEn: string;
  /** Продавец оплачивает основную перевозку → доставка обычно уже сидит в цене товара. */
  freightInPrice: boolean;
  /** В цену входит и страхование груза продавцом (только CIF и CIP). */
  insuranceInPrice: boolean;
  /** Базис только для водного транспорта (FAS, FOB, CFR, CIF). */
  seaOnly: boolean;
  /** Место назначения обычно внутри РФ — в цену входит плечо перевозки после границы (DAP, DPU, DDP). */
  deliveredInCountry: boolean;
  /** В цену по определению входят ввозные пошлины и налоги (только DDP). */
  dutiesInPrice: boolean;
  /** Короткая суть для бейджа в селекте/карточке: «доставка не в цене» и т.п. */
  summary: string;
  /** Одно предложение: кто несёт расходы и риск и до какого момента. */
  transfer: string;
}

export const INCOTERMS_INFO: Record<Incoterms, IncotermsInfo> = {
  EXW: {
    nameRu: 'Франко-завод',
    nameEn: 'Ex Works',
    freightInPrice: false,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'доставка не в цене',
    transfer:
      'Продавец лишь предоставляет товар на своём складе; погрузку, вывоз, экспортное оформление и всю доставку до границы ЕАЭС организует и оплачивает покупатель.',
  },
  FCA: {
    nameRu: 'Франко-перевозчик',
    nameEn: 'Free Carrier',
    freightInPrice: false,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'доставка не в цене',
    transfer:
      'Продавец передаёт товар перевозчику, назначенному покупателем, и оформляет экспорт; основную перевозку до границы ЕАЭС оплачивает покупатель.',
  },
  FAS: {
    nameRu: 'Франко вдоль борта судна',
    nameEn: 'Free Alongside Ship',
    freightInPrice: false,
    insuranceInPrice: false,
    seaOnly: true,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'доставка не в цене',
    transfer:
      'Продавец доставляет товар к борту судна в порту отгрузки и оформляет экспорт; погрузку на судно и морской фрахт оплачивает покупатель. Только водный транспорт.',
  },
  FOB: {
    nameRu: 'Франко борт',
    nameEn: 'Free On Board',
    freightInPrice: false,
    insuranceInPrice: false,
    seaOnly: true,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'доставка не в цене',
    transfer:
      'Продавец грузит товар на борт судна в порту отгрузки и оформляет экспорт; морской фрахт и страхование оплачивает покупатель. Только водный транспорт.',
  },
  CFR: {
    nameRu: 'Стоимость и фрахт',
    nameEn: 'Cost and Freight',
    freightInPrice: true,
    insuranceInPrice: false,
    seaOnly: true,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'фрахт в цене',
    transfer:
      'Продавец оплачивает морской фрахт до порта назначения, но риск переходит к покупателю уже при погрузке на судно; страхование — на покупателе. Только водный транспорт.',
  },
  CIF: {
    nameRu: 'Стоимость, страхование и фрахт',
    nameEn: 'Cost, Insurance and Freight',
    freightInPrice: true,
    insuranceInPrice: true,
    seaOnly: true,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'фрахт и страховка в цене',
    transfer:
      'Как CFR, но продавец дополнительно оплачивает страхование груза по минимальному покрытию (ICC C) до порта назначения. Только водный транспорт.',
  },
  CPT: {
    nameRu: 'Перевозка оплачена до',
    nameEn: 'Carriage Paid To',
    freightInPrice: true,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'фрахт в цене',
    transfer:
      'Продавец оплачивает перевозку любым транспортом до места назначения, но риск переходит к покупателю уже при передаче первому перевозчику; страхование — на покупателе.',
  },
  CIP: {
    nameRu: 'Перевозка и страхование оплачены до',
    nameEn: 'Carriage and Insurance Paid To',
    freightInPrice: true,
    insuranceInPrice: true,
    seaOnly: false,
    deliveredInCountry: false,
    dutiesInPrice: false,
    summary: 'фрахт и страховка в цене',
    transfer:
      'Как CPT, но продавец дополнительно оплачивает страхование груза с расширенным покрытием (ICC A, нововведение Incoterms 2020). Любой транспорт.',
  },
  DAP: {
    nameRu: 'Поставка в месте назначения',
    nameEn: 'Delivered at Place',
    freightInPrice: true,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: true,
    dutiesInPrice: false,
    summary: 'доставка в цене',
    transfer:
      'Продавец за свой счёт доставляет товар в согласованное место (обычно внутри РФ), готовым к разгрузке; разгрузку, импортное оформление и пошлины оплачивает покупатель.',
  },
  DPU: {
    nameRu: 'Поставка в месте выгрузки',
    nameEn: 'Delivered at Place Unloaded',
    freightInPrice: true,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: true,
    dutiesInPrice: false,
    summary: 'доставка и выгрузка в цене',
    transfer:
      'Как DAP, но продавец ещё и разгружает товар в месте назначения; импортное оформление и пошлины — на покупателе. Единственный термин с обязанностью продавца выгрузить товар.',
  },
  DDP: {
    nameRu: 'Поставка с оплатой пошлины',
    nameEn: 'Delivered Duty Paid',
    freightInPrice: true,
    insuranceInPrice: false,
    seaOnly: false,
    deliveredInCountry: true,
    dutiesInPrice: true,
    summary: 'доставка и пошлины в цене',
    transfer:
      'Продавец несёт все расходы до места в РФ, включая импортное оформление, пошлины и налоги (НДС); у покупателя минимум обязанностей. Максимальные обязательства продавца.',
  },
};

/** Подпись значения для `<option>`: «EXW — Франко-завод». */
export function incotermsOptionLabel(term: Incoterms): string {
  return `${term} — ${INCOTERMS_INFO[term].nameRu}`;
}

/**
 * Плейсхолдер поля «Фрахт до границы» в зависимости от выбранного базиса —
 * мягкая подсказка прямо в поле: ждём ли мы здесь сумму (EXW/FCA/FAS/FOB) или
 * обычно 0, потому что доставка уже в цене (C- и D-термины). Значение поля не
 * меняет — только направляет ввод. Пустой базис → нейтральный «0».
 */
export function incotermsFreightPlaceholder(term: Incoterms | ''): string {
  if (!term) return '0';
  return INCOTERMS_INFO[term].freightInPrice ? 'уже в цене' : 'нужен фрахт';
}

/**
 * Как выбранный базис влияет на расчёт (для карточки-справки). Текст детерминирован
 * признаками термина: оплачивает ли продавец перевозку, входит ли страхование,
 * и не заходит ли доставка вглубь РФ (тогда часть цены нужно вычитать из ТС).
 */
export function incotermsCalcImpact(term: Incoterms): string {
  const info = INCOTERMS_INFO[term];
  if (!info.freightInPrice) {
    return (
      'Доставку до границы ЕАЭС оплачивает покупатель — в цену товара она не входит. Чтобы ' +
      'таможенная стоимость (и база пошлины, акциза, НДС) была полной, задайте «Фрахт до границы».'
    );
  }
  let text =
    'Основную перевозку оплачивает продавец — доставка обычно уже в цене товара и в таможенной ' +
    'стоимости, отдельно «Фрахт до границы» задавать не нужно.';
  if (info.insuranceInPrice) {
    text += ' Страхование груза тоже на продавце — оно уже в цене и в таможенной стоимости.';
  }
  if (info.deliveredInCountry) {
    text += info.dutiesInPrice
      ? ' Место назначения обычно внутри РФ, поэтому в цену входят и перевозка по России после ' +
        'границы, и ввозные пошлины с НДС — в таможенную стоимость они не входят, но инструмент их ' +
        'не вычитает автоматически.'
      : ' Место назначения обычно внутри РФ, поэтому в цену входит и перевозка по России после ' +
        'границы — в таможенную стоимость она не входит, но инструмент её не вычитает автоматически.';
  }
  return text;
}

export type IncotermsTone = 'ok' | 'warn' | 'info';

export interface IncotermsConsistency {
  tone: IncotermsTone;
  text: string;
}

/**
 * Живой предпросмотр того, согласован ли выбранный базис с текущим значением фрахта.
 * Зеркалит серверные предупреждения `incotermsFreightNote` (двойной счёт / занижение ТС)
 * и дополнительно подсвечивает завышение ТС для D-терминов (DAP/DPU/DDP), которое
 * бинарная серверная модель «фрахт в цене / не в цене» пока не выражает.
 */
export function incotermsFreightConsistency(
  term: Incoterms,
  hasFreight: boolean,
): IncotermsConsistency {
  const info = INCOTERMS_INFO[term];

  // Группа D: доставка заходит вглубь РФ, поэтому цена включает пост-граничное плечо
  // (а у DDP — ещё пошлины/НДС). Эти суммы в ТС не входят, но и не вычитаются автоматически.
  if (info.deliveredInCountry) {
    const inland = info.dutiesInPrice
      ? 'перевозку по РФ после границы, а также ввозные пошлины и НДС'
      : 'перевозку по РФ после места прибытия на границу';
    if (hasFreight) {
      return {
        tone: 'warn',
        text:
          `Доставка до места в РФ уже включена в цену, а сверху задан фрахт — таможенная стоимость ` +
          `задвоится. Обнулите фрахт (0), если он уже в цене. К тому же цена включает ${inland} — ` +
          `эти суммы в таможенную стоимость не входят, вычтите их вручную.`,
      };
    }
    return {
      tone: 'info',
      text:
        `Цена по этому базису включает ${inland}. Эти суммы в таможенную стоимость не входят, но ` +
        `инструмент их не вычитает — таможенная стоимость, пошлина и НДС могут быть завышены. ` +
        `Вычтите внутреннее плечо${info.dutiesInPrice ? ' и ввозные платежи' : ''} вручную при ` +
        `документальном подтверждении (п. 2 ст. 40 ТК ЕАЭС).`,
    };
  }

  // Чистые C-термины: перевозку оплачивает продавец, доставка уже в цене.
  if (info.freightInPrice) {
    if (hasFreight) {
      return {
        tone: 'warn',
        text:
          `Доставка уже включена в цену товара, но дополнительно задан фрахт — таможенная стоимость ` +
          `может задвоиться. Обнулите фрахт (0), если он уже в цене.`,
      };
    }
    return {
      tone: 'ok',
      text:
        `Доставка${info.insuranceInPrice ? ' и страхование груза' : ''} уже в цене — отдельный фрахт ` +
        `задавать не нужно, структура таможенной стоимости корректна.`,
    };
  }

  // Группа E/F: перевозку до границы оплачивает покупатель.
  if (hasFreight) {
    return {
      tone: 'ok',
      text: 'Фрахт до границы задан — он войдёт в таможенную стоимость, структура корректна.',
    };
  }
  return {
    tone: 'warn',
    text:
      'Доставка до границы ЕАЭС не входит в цену, а фрахт не задан — таможенная стоимость, пошлина ' +
      'и НДС занижены. Укажите «Фрахт до границы» и пересчитайте.',
  };
}
