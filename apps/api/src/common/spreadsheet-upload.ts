import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ErrorCode } from './error-codes';

/**
 * Общий multer-конфиг для загрузки .xlsx/.csv (≤40 МБ). Переиспользуется
 * админским upload, ботовым upload и managed intake.
 */
export const SPREADSHEET_UPLOAD: MulterOptions & { defParamCharset?: string } = {
  limits: { fileSize: 40 * 1024 * 1024 },
  // Иначе busboy парсит filename= как latin1 — не-ASCII имена становятся mojibake.
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'csv') cb(null, true);
    else
      cb(
        new BadRequestException({
          code: ErrorCode.UNSUPPORTED_FORMAT,
          message: 'Only .xlsx and .csv files are supported',
        }),
        false,
      );
  },
};
