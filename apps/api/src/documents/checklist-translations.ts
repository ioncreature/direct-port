import type { ShipmentDocumentSpec } from '../regulatory/curated/base-package';
import type { DocumentTimingKey } from '../regulatory/curated/document-timing';

/**
 * Переводы заголовков пунктов чек-листа «Документы к поставке» для локализованной
 * колонки Excel (document.language = en/zh). Чек-лист генерируется без AI, поэтому
 * переводы статичны; пояснения (details) остаются на русском.
 *
 * Заголовки статичных пунктов (базовый пакет, досье) переведены прямо в записях
 * ShipmentDocumentSpec (titleEn/titleZh — обязательные поля, полноту гарантирует
 * компилятор). Здесь — только шаблоны для пунктов, порождаемых из regulatoryReport
 * и curated-волн: ключи совпадают с DocumentTimingKey, что тоже проверяется типом.
 */

type Lang = 'en' | 'zh';

/** Шаблоны заголовков TKS/curated-пунктов; {reg} = «ТР ТС 020/2011» (языконезависим). */
const TEMPLATE_TITLES: Record<DocumentTimingKey | 'marking_wave', Record<Lang, string>> = {
  tr_certificate: { en: 'Certificate of conformity {reg}', zh: '{reg} 合格证书' },
  tr_declaration: { en: 'Declaration of conformity {reg}', zh: '{reg} 合格声明' },
  state_registration: {
    en: 'State registration certificate (SGR) {reg}',
    zh: '国家注册证书（SGR）{reg}',
  },
  fsb_notification: {
    en: 'FSB notification (encryption features)',
    zh: '联邦安全局加密产品备案（нотификация）',
  },
  conformity_generic: { en: 'Conformity assessment document {reg}', zh: '合格评定文件 {reg}' },
  import_license: { en: 'Import licence', zh: '进口许可证' },
  import_permit: { en: 'Import permit', zh: '进口批准文件' },
  utilization_fee: { en: 'Utilisation fee calculation', zh: '回收利用费（утильсбор）计算' },
  marking: { en: '“Chestny ZNAK” marking', zh: '“诚实标志”（Честный знак）标识' },
  marking_wave: {
    en: '“Chestny ZNAK” marking — mandatory from {date}',
    zh: '“诚实标志”标识——自 {date} 起强制',
  },
  dual_use: { en: 'Export control / dual-use check', zh: '出口管制 / 两用物项核查' },
  origin_certificate: {
    en: 'Non-preferential certificate of origin',
    zh: '非优惠原产地证书',
  },
};

function isSupported(language: string | null | undefined): language is Lang {
  return language === 'en' || language === 'zh';
}

/** Перевод заголовка статичного пункта из его собственных полей; null — язык не en/zh. */
export function localizedSpecTitle(
  spec: Pick<ShipmentDocumentSpec, 'titleEn' | 'titleZh'>,
  language: string | null | undefined,
): string | null {
  if (!isSupported(language)) return null;
  return language === 'en' ? spec.titleEn : spec.titleZh;
}

/**
 * Перевод заголовка по шаблону типа пункта. `reg` — идентификатор регламента
 * («ТР ТС 020/2011»), `date` — дата волны маркировки в формате DD.MM.YYYY.
 */
export function translateTemplateTitle(
  key: DocumentTimingKey | 'marking_wave',
  language: string | null | undefined,
  params: { reg?: string | null; date?: string } = {},
): string | null {
  if (!isSupported(language)) return null;
  return TEMPLATE_TITLES[key][language]
    .replace('{reg}', params.reg ?? '')
    .replace('{date}', params.date ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
