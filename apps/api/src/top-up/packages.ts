/**
 * Справочник тарифов пополнения (конфигом, без таблицы). Соответствует лендингу.
 * Цена за позицию копируется в TopUpRequest.pricePerPosition при создании заявки —
 * изменение тарифа не действует задним числом.
 */
export interface TopUpPackage {
  key: string;
  positions: number;
  amount: number;
  perPosition: number;
  currency: string;
  /** Доступен клиенту для самостоятельной заявки. 'free' выдаёт только менеджер
   *  грантом (онбординг) — за деньги не покупается, поэтому в кабинете не показывается. */
  purchasable: boolean;
}

export const TOP_UP_CURRENCY = 'USD';

export const TOP_UP_PACKAGES: readonly TopUpPackage[] = [
  { key: 'free', positions: 50, amount: 0, perPosition: 0, currency: TOP_UP_CURRENCY, purchasable: false },
  { key: 'p100', positions: 100, amount: 100, perPosition: 1.0, currency: TOP_UP_CURRENCY, purchasable: true },
  { key: 'p500', positions: 500, amount: 450, perPosition: 0.9, currency: TOP_UP_CURRENCY, purchasable: true },
  { key: 'p5000', positions: 5000, amount: 4000, perPosition: 0.8, currency: TOP_UP_CURRENCY, purchasable: true },
];

/** Пакеты, доступные клиенту в кабинете (без grant-only 'free'). */
export function purchasablePackages(): TopUpPackage[] {
  return TOP_UP_PACKAGES.filter((p) => p.purchasable);
}

/** Покупаемый пакет по ключу, иначе undefined (включая попытку купить grant-only 'free'). */
export function findPurchasablePackage(key: string): TopUpPackage | undefined {
  return TOP_UP_PACKAGES.find((p) => p.key === key && p.purchasable);
}
