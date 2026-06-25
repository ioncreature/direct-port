import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Лимит/фильтр для self-service загрузки кабинета (.xlsx/.csv, ≤40 МБ). Отбраковывает
 * неподходящий файл ещё на BFF, до форварда в api (api валидирует повторно).
 * Зеркало apps/api/src/common/spreadsheet-upload.ts — общий код между apps идёт только
 * через libs, межапповое дублирование тонких конфигов здесь норма.
 */
export const SPREADSHEET_UPLOAD: MulterOptions & { defParamCharset?: string } = {
  limits: { fileSize: 40 * 1024 * 1024 },
  // Иначе busboy парсит filename= как latin1 — не-ASCII имена становятся mojibake.
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'csv') cb(null, true);
    else cb(new BadRequestException('Only .xlsx and .csv files are supported'), false);
  },
};
