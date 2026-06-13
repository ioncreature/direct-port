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
      /** Оригинал из файла до перевода Claude — для не-ru пользователей. */
      descriptionOriginal?: string;
      threshold: number;
    }
  | {
      type: 'low_confidence_with_code';
      row: number;
      description: string;
      descriptionOriginal?: string;
      code: string;
      confidence: number;
      threshold: number;
    }
  | {
      /** Код взят из TKS-поиска без AI-проверки (Claude недоступен или батч упал). */
      type: 'unverified_code';
      row: number;
      description: string;
      descriptionOriginal?: string;
      code: string;
    };

/**
 * Единый builder причины «строка требует ревью кода» из строки resultData /
 * CalculatedProduct. Ветвление (no_match → unverified → low_confidence) должно
 * совпадать с критерием rowNeedsCodeReview (common/confidence.ts) — обе функции
 * читают одни и те же поля; используется processor'ом и manual-code.
 */
export function buildLowConfidenceReasonData(
  rowNumber: number,
  row: {
    description?: unknown;
    tnVedCode?: unknown;
    matchConfidence?: unknown;
    matched?: unknown;
    verified?: unknown;
  },
  threshold: number,
  descriptionOriginal?: string,
): RejectionReasonData {
  const description = String(row.description ?? '');
  if (!row.matched) {
    return {
      type: 'low_confidence_no_match',
      row: rowNumber,
      description,
      descriptionOriginal,
      threshold,
    };
  }
  // Код есть и уверенность может быть высокой, но AI-проверка не отработала —
  // это отдельная причина: «не уверены» здесь было бы неправдой про число.
  if (!(row.verified ?? true)) {
    return {
      type: 'unverified_code',
      row: rowNumber,
      description,
      descriptionOriginal,
      code: String(row.tnVedCode ?? ''),
    };
  }
  return {
    type: 'low_confidence_with_code',
    row: rowNumber,
    description,
    descriptionOriginal,
    code: String(row.tnVedCode ?? ''),
    confidence: Number(row.matchConfidence) || 0,
    threshold,
  };
}

type Lang = 'ru' | 'en' | 'zh';
type Templates = Record<Lang, string>;

function normalizeLang(language: string | undefined): Lang {
  if (language === 'en' || language === 'zh') return language;
  return 'ru';
}

function pickDescription(
  data: { description: string; descriptionOriginal?: string },
  lang: Lang,
): string {
  if (lang !== 'ru' && data.descriptionOriginal) return data.descriptionOriginal;
  return data.description || '—';
}

function buildTemplates(data: RejectionReasonData): Templates {
  switch (data.type) {
    case 'no_products':
      return {
        ru:
          'Не удалось найти ни одной товарной строки в файле.\n' +
          '   Проверьте, что в файле есть колонки с наименованием, ценой, весом и количеством, и что данные товаров идут после строки заголовка.',
        en:
          'No product rows were found in the file.\n' +
          '   Make sure the file has columns for name, price, weight and quantity, and that product data comes after the header row.',
        zh:
          '文件中未找到任何商品行。\n' +
          '   请确认文件中包含名称、价格、重量和数量列，且商品数据位于表头行之后。',
      };
    case 'zero_price':
      return {
        ru:
          `Не указана цена у ${data.count} из ${data.total} товаров.\n` +
          '   Без цены за единицу нельзя рассчитать пошлину и НДС. Проверьте колонку с ценой — возможно, в ней пустые ячейки или нули.',
        en:
          `Price is missing for ${data.count} of ${data.total} products.\n` +
          '   Duty and VAT cannot be calculated without a unit price. Check the price column — there may be empty cells or zeros.',
        zh:
          `${data.total} 件商品中有 ${data.count} 件未填写价格。\n` +
          '   没有单价无法计算关税和增值税。请检查价格列 — 可能存在空单元格或零值。',
      };
    case 'empty_description':
      return {
        ru:
          `У ${data.count} из ${data.total} товаров отсутствует наименование (или оно слишком короткое).\n` +
          '   Название нужно, чтобы подобрать код ТН ВЭД. Укажите для каждого товара хотя бы краткое описание (что это, из чего, для чего).',
        en:
          `${data.count} of ${data.total} products have a missing or very short name.\n` +
          '   The name is required to match an HS code. Please add at least a brief description (what it is, what it is made of, what it is for).',
        zh:
          `${data.total} 件商品中有 ${data.count} 件没有名称或名称过短。\n` +
          '   匹配 HS 编码需要商品名称。请为每件商品至少填写简短描述（是什么、由什么制成、用途）。',
      };
    case 'zero_weight':
      return {
        ru:
          `Не указан вес у ${data.count} из ${data.total} товаров.\n` +
          '   Вес одной единицы в килограммах нужен для расчёта пошлины. Проверьте колонку «вес» — единица измерения должна быть кг, не граммы.',
        en:
          `Weight is missing for ${data.count} of ${data.total} products.\n` +
          '   The unit weight in kilograms is required for duty calculation. Check the weight column — the unit must be kg, not grams.',
        zh:
          `${data.total} 件商品中有 ${data.count} 件未填写重量。\n` +
          '   计算关税需要单件重量（千克）。请检查重量列 — 单位应为千克，而非克。',
      };
    case 'too_many_rows':
      return {
        ru:
          `Файл содержит слишком много товарных позиций (более ${data.max}).\n` +
          `   Разделите его на несколько файлов по ${data.max} позиций или меньше и загрузите по очереди.`,
        en:
          `The file contains too many product rows (more than ${data.max}).\n` +
          `   Split it into several files of up to ${data.max} rows each and upload them one by one.`,
        zh:
          `文件中商品行数过多（超过 ${data.max} 条）。\n` +
          `   请将文件拆分为每份不超过 ${data.max} 行的多个文件，并逐个上传。`,
      };
    case 'file_empty':
      return {
        ru:
          'Файл пустой или содержит только заголовок без товарных строк.\n' +
          '   Добавьте данные товаров под строкой заголовка и загрузите файл снова.',
        en:
          'The file is empty or contains only a header row.\n' +
          '   Add product rows below the header and upload the file again.',
        zh:
          '文件为空或仅包含表头。\n' +
          '   请在表头下方添加商品数据后重新上传。',
      };
    case 'file_too_large':
      return {
        ru:
          'Содержимое файла слишком объёмное по тексту.\n' +
          '   Сократите количество текста в ячейках (длинные описания, технические комментарии) или разделите файл на несколько частей.',
        en:
          'The file content is too large in terms of text.\n' +
          '   Reduce the amount of text in cells (long descriptions, technical comments) or split the file into several parts.',
        zh:
          '文件中的文本内容过多。\n' +
          '   请减少单元格中的文本量（过长的描述、技术备注）或将文件拆分为若干部分。',
      };
    case 'low_confidence_no_match': {
      const ru = pickDescription(data, 'ru');
      const en = pickDescription(data, 'en');
      const zh = pickDescription(data, 'zh');
      return {
        ru:
          `Строка ${data.row} «${ru}» — не удалось подобрать код ТН ВЭД.\n` +
          '   Уточните наименование (что это, из чего, для чего) или впишите код ТН ВЭД в отдельную колонку — тогда система воспользуется им напрямую.',
        en:
          `Row ${data.row} "${en}" — no HS code could be matched.\n` +
          '   Clarify the name (what it is, what it is made of, what it is for) or add an HS code in a separate column so the system can use it directly.',
        zh:
          `第 ${data.row} 行「${zh}」— 未能匹配到 HS 编码。\n` +
          '   请补充更具体的名称（是什么、由什么制成、用途），或在独立列中填写 HS 编码，系统将直接使用。',
      };
    }
    case 'low_confidence_with_code': {
      const code = data.code || '—';
      const ru = pickDescription(data, 'ru');
      const en = pickDescription(data, 'en');
      const zh = pickDescription(data, 'zh');
      return {
        ru:
          `Строка ${data.row} «${ru}» — система не уверена в коде ${code}.\n` +
          '   Это часто значит, что описание слишком общее. Добавьте подробностей (материал, состав, назначение, для кого), либо укажите код ТН ВЭД в отдельной колонке вручную.',
        en:
          `Row ${data.row} "${en}" — the system is not sure about code ${code}.\n` +
          '   The description is likely too generic. Add details (material, composition, purpose, target user) or specify an HS code in a separate column manually.',
        zh:
          `第 ${data.row} 行「${zh}」— 系统对编码 ${code} 不太确定。\n` +
          '   通常是因为描述过于笼统。请补充细节（材质、成分、用途、目标用户），或在独立列中手动填写 HS 编码。',
      };
    }
    case 'unverified_code': {
      const code = data.code || '—';
      const ru = pickDescription(data, 'ru');
      const en = pickDescription(data, 'en');
      const zh = pickDescription(data, 'zh');
      return {
        ru:
          `Строка ${data.row} «${ru}» — код ${code} подобран по справочнику без AI-проверки.\n` +
          '   Автоматическая верификация кода не отработала. Проверьте код вручную или запустите повторную обработку документа.',
        en:
          `Row ${data.row} "${en}" — code ${code} was picked from the reference without AI verification.\n` +
          '   Automatic code verification did not run. Check the code manually or reprocess the document.',
        zh:
          `第 ${data.row} 行「${zh}」— 编码 ${code} 仅按目录匹配，未经过 AI 校验。\n` +
          '   自动校验未执行。请手动核对编码，或重新处理该文件。',
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

