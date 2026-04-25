/**
 * Структурированные причины отклонения документа.
 *
 * `rejectionReasons` (string[]) хранится в БД на русском — для админки и логов.
 * `rejectionReasonsData` (RejectionReasonData[]) сохраняет машиночитаемые
 * параметры причин и используется для рендеринга на языке пользователя
 * Telegram-бота (en/zh). Русский рендер совпадает с тем, что лежит в БД.
 */

export type RejectionReasonData =
  | { type: 'no_products' }
  | { type: 'zero_price'; count: number; total: number }
  | { type: 'empty_description'; count: number; total: number }
  | { type: 'zero_weight'; count: number; total: number }
  | { type: 'too_many_rows'; max: number }
  | { type: 'file_empty' }
  | { type: 'file_too_large'; sizeKChars: number; maxKChars: number }
  | {
      type: 'low_confidence_no_match';
      row: number;
      description: string;
      threshold: number;
    }
  | {
      type: 'low_confidence_with_code';
      row: number;
      description: string;
      code: string;
      confidence: number;
      threshold: number;
    };

type Lang = 'ru' | 'en' | 'zh';
type Templates = Record<Lang, string>;

function normalizeLang(language: string | undefined): Lang {
  if (language === 'en' || language === 'zh') return language;
  return 'ru';
}

function buildTemplates(data: RejectionReasonData): Templates {
  switch (data.type) {
    case 'no_products':
      return {
        ru: 'Не удалось извлечь ни одного товара из файла.',
        en: 'Failed to extract any products from the file.',
        zh: '无法从文件中提取任何商品。',
      };
    case 'zero_price':
      return {
        ru: `Не удалось определить цены: у ${data.count} из ${data.total} товаров цена нулевая или не найдена.`,
        en: `Failed to determine prices: ${data.count} of ${data.total} products have zero or missing price.`,
        zh: `无法确定价格：${data.total} 件商品中有 ${data.count} 件价格为零或缺失。`,
      };
    case 'empty_description':
      return {
        ru: `Описания товаров отсутствуют или слишком короткие для классификации по ТН ВЭД (${data.count} из ${data.total}).`,
        en: `Product descriptions are missing or too short for HS code classification (${data.count} of ${data.total}).`,
        zh: `商品描述缺失或过短，无法进行 HS 编码分类（${data.total} 件中有 ${data.count} 件）。`,
      };
    case 'zero_weight':
      return {
        ru: `Не указан вес у ${data.count} из ${data.total} товаров. Вес необходим для расчёта пошлин.`,
        en: `Weight is missing for ${data.count} of ${data.total} products. Weight is required for duty calculation.`,
        zh: `${data.total} 件商品中有 ${data.count} 件未指定重量。重量是计算关税所必需的。`,
      };
    case 'too_many_rows':
      return {
        ru: `Файл содержит слишком много строк (более ${data.max}). Пожалуйста, разделите файл на части не более ${data.max} строк.`,
        en: `The file contains too many rows (more than ${data.max}). Please split the file into parts of no more than ${data.max} rows.`,
        zh: `文件包含的行数过多（超过 ${data.max}）。请将文件拆分为每份不超过 ${data.max} 行。`,
      };
    case 'file_empty':
      return {
        ru: 'Файл пустой или содержит только заголовок (менее 2 строк).',
        en: 'The file is empty or contains only a header row (less than 2 rows).',
        zh: '文件为空或仅包含标题行（少于 2 行）。',
      };
    case 'file_too_large':
      return {
        ru: `Содержимое файла слишком большое (${data.sizeKChars}K символов). Максимум — ${data.maxKChars}K. Уменьшите объём текста в ячейках или разделите файл.`,
        en: `The file content is too large (${data.sizeKChars}K characters). Maximum is ${data.maxKChars}K. Reduce the amount of text in cells or split the file.`,
        zh: `文件内容过大（${data.sizeKChars}K 字符）。上限为 ${data.maxKChars}K。请减少单元格中的文本或拆分文件。`,
      };
    case 'low_confidence_no_match': {
      const desc = data.description || '—';
      const threshold = data.threshold.toFixed(2);
      return {
        ru: `Строка ${data.row}: «${desc}» — код ТН ВЭД не определён (ниже порога ${threshold}).`,
        en: `Row ${data.row}: «${desc}» — HS code not determined (below threshold ${threshold}).`,
        zh: `第 ${data.row} 行：«${desc}» — 未能确定 HS 编码（低于阈值 ${threshold}）。`,
      };
    }
    case 'low_confidence_with_code': {
      const desc = data.description || '—';
      const code = data.code || '—';
      const confidence = data.confidence.toFixed(2);
      const threshold = data.threshold.toFixed(2);
      return {
        ru: `Строка ${data.row}: «${desc}» — код ${code}, уверенность ${confidence} (ниже порога ${threshold}).`,
        en: `Row ${data.row}: «${desc}» — code ${code}, confidence ${confidence} (below threshold ${threshold}).`,
        zh: `第 ${data.row} 行：«${desc}» — 编码 ${code}，置信度 ${confidence}（低于阈值 ${threshold}）。`,
      };
    }
  }
}

export function formatRejectionReason(
  data: RejectionReasonData,
  language: string | undefined,
): string {
  return buildTemplates(data)[normalizeLang(language)];
}

export function formatRejectionReasons(
  data: RejectionReasonData[],
  language: string | undefined,
): string[] {
  return data.map((d) => formatRejectionReason(d, language));
}

/**
 * Возвращает локализованный массив для бота. Для русскоязычного пользователя
 * (или если данных нет) возвращает undefined — handler возьмёт fallback из
 * `rejectionReasons` (русские строки из БД).
 */
export function localizeRejectionReasonsForUser(
  data: RejectionReasonData[],
  language: string | undefined,
): string[] | undefined {
  if (!language || language === 'ru' || data.length === 0) return undefined;
  return formatRejectionReasons(data, language);
}
