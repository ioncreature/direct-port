import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ErrorCode } from '../common/error-codes';

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * Multer-конфиг для загрузки брендинговых ассетов компании — логотипа и favicon (≤2 МБ;
 * PNG/JPEG/WebP/SVG). Файл держится в памяти (buffer) — CompanyAssetService ресайзит растровые
 * через sharp и санитайзит SVG. Фильтр — первый барьер по mime/расширению; окончательную
 * валидность формата решает сервис.
 */
export const ASSET_UPLOAD: MulterOptions = {
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = ALLOWED_MIME.includes(file.mimetype);
    const okExt = /\.(png|jpe?g|webp|svg)$/i.test(file.originalname);
    if (okMime || okExt) cb(null, true);
    else
      cb(
        new BadRequestException({
          code: ErrorCode.UNSUPPORTED_FORMAT,
          message: 'Поддерживаются только PNG, JPEG, WebP и SVG',
        }),
        false,
      );
  },
};
