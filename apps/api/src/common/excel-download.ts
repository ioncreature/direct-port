const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Заголовки для отдачи xlsx как attachment с именем по RFC 5987 (ASCII filename +
 * UTF-8 fallback для кириллицы). Общие для всех download-эндпоинтов (админка, бот,
 * кабинет), чтобы content-type и кодировка имени не разъезжались между копиями.
 */
export function xlsxDownloadHeaders(fileName: string): Record<string, string> {
  const encoded = encodeURIComponent(fileName);
  return {
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
  };
}
