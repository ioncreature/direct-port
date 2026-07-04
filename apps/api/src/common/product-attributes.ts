/**
 * Структурированные атрибуты товарной позиции, извлекаемые AI-парсером из
 * наименования и дополнительных колонок исходного файла. В отличие от плоского
 * rawContext (свалка «колонка=значение») — это типизированные поля, на которые
 * опираются классификатор (материал/назначение сильно влияют на группу ТН ВЭД)
 * и, в перспективе, генерация описания для графы 31 ДТ.
 */

export const PRODUCT_ATTRIBUTE_KEYS = [
  'material',
  'purpose',
  'brand',
  'article',
  'model',
  'manufacturer',
] as const;

export type ProductAttributeKey = (typeof PRODUCT_ATTRIBUTE_KEYS)[number];

export type ProductAttributes = Partial<Record<ProductAttributeKey, string>>;

const RU_LABELS: Record<ProductAttributeKey, string> = {
  material: 'материал',
  purpose: 'назначение',
  brand: 'бренд',
  article: 'артикул',
  model: 'модель',
  manufacturer: 'производитель',
};

const MAX_ATTRIBUTE_VALUE_CHARS = 200;

/**
 * Нормализует attributes из ответа Claude или из JSONB parsedData (после ручной
 * правки оператором): только известные ключи, строки, trim + кап длины.
 * Возвращает undefined, если валидных атрибутов не осталось.
 */
export function normalizeProductAttributes(raw: unknown): ProductAttributes | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const out: ProductAttributes = {};
  for (const key of PRODUCT_ATTRIBUTE_KEYS) {
    const value = obj[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_ATTRIBUTE_VALUE_CHARS);
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Каноническая однострочная форма «материал=сталь; бренд=Bosch» — для промптов
 * (контекст формулирования запросов, vision) и ключей кэша/дедупликации.
 * Порядок ключей фиксирован PRODUCT_ATTRIBUTE_KEYS, поэтому строка стабильна.
 */
export function formatProductAttributes(attrs: ProductAttributes | undefined): string {
  if (!attrs) return '';
  return PRODUCT_ATTRIBUTE_KEYS.filter((k) => attrs[k])
    .map((k) => `${RU_LABELS[k]}=${attrs[k]}`)
    .join('; ');
}
