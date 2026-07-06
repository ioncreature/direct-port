import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
// sharp — CommonJS-модуль; require обходит проблемы default-import/namespace (как в photo-storage).
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
import { errMsg } from '../common/errors';
import { Company } from '../database/entities/company.entity';

/** Растровые логотипы ресайзятся под этот потолок (шапка/логин показывают ≤48px — с запасом на retina). */
const MAX_DIMENSION_PX = 512;
/** Потолок пикселей входного растра для sharp/libvips — отсекает декомпрессионные бомбы. */
const MAX_INPUT_PIXELS = 50_000_000;
/** SVG — это разметка, «пиксельной бомбы» нет; ограничиваем размер файла. */
const MAX_SVG_BYTES = 512 * 1024;

interface SvgPurifier {
  sanitize(dirty: string, config: Record<string, unknown>): string;
}

// Ленивая инициализация jsdom+DOMPurify (серверный санитайзинг недоверенного SVG). Грузим по
// требованию, а не на верхнем уровне: jsdom тянет ESM-зависимость, ломающую загрузку модуля в jest,
// и нужен только при реальном приёме SVG. Одна песочница на процесс.
let svgPurifier: SvgPurifier | null = null;
function getSvgPurifier(): SvgPurifier {
  if (!svgPurifier) {
    const createDOMPurify = require('dompurify') as (win: unknown) => SvgPurifier;
    const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: unknown } };
    svgPurifier = createDOMPurify(new JSDOM('').window);
  }
  return svgPurifier;
}

export interface UploadedLogoFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface LogoBlob {
  bytes: Buffer;
  mime: string;
  hash: string;
}

/**
 * Логотип тенанта: нормализация загруженного файла (растровые → PNG через sharp; SVG →
 * санитайзинг DOMPurify), хранение в companies и чтение байтов для отдачи. Один логотип на
 * компанию. Управление — только super_admin (CompanyLogoController); публичная отдача по
 * домену — TenantController.
 */
@Injectable()
export class CompanyLogoService {
  private logger = new Logger(CompanyLogoService.name);

  constructor(@InjectRepository(Company) private companiesRepo: Repository<Company>) {}

  /** Загрузить/заменить логотип: нормализовать, сохранить, вернуть новый hash (для cache-busting). */
  async setLogo(companyId: string, file: UploadedLogoFile): Promise<{ logoHash: string }> {
    if (!(await this.companiesRepo.existsBy({ id: companyId }))) {
      throw new NotFoundException('Company not found');
    }
    const blob = await this.normalize(file);
    await this.companiesRepo.update(
      { id: companyId },
      { logoBytes: blob.bytes, logoMime: blob.mime, logoHash: blob.hash },
    );
    this.logger.log(`Set logo for company ${companyId}: ${blob.mime}, ${blob.bytes.length} bytes`);
    return { logoHash: blob.hash };
  }

  /** Снять логотип компании (вернётся дефолтная марка DirectPort). */
  async removeLogo(companyId: string): Promise<void> {
    const res = await this.companiesRepo.update(
      { id: companyId },
      { logoBytes: null, logoMime: null, logoHash: null },
    );
    if (!res.affected) throw new NotFoundException('Company not found');
  }

  /** Байты логотипа (logo_bytes — select:false, читаем явным addSelect). null — логотипа нет. */
  async getLogo(companyId: string): Promise<LogoBlob | null> {
    const row = await this.companiesRepo
      .createQueryBuilder('c')
      .select('c.logoMime', 'mime')
      .addSelect('c.logoHash', 'hash')
      .addSelect('c.logoBytes', 'bytes')
      .where('c.id = :id', { id: companyId })
      .andWhere('c.logoBytes IS NOT NULL')
      .getRawOne<{ mime: string; hash: string; bytes: Buffer }>();
    return row ? { bytes: row.bytes, mime: row.mime, hash: row.hash } : null;
  }

  private async normalize(file: UploadedLogoFile): Promise<LogoBlob> {
    return this.isSvg(file) ? this.normalizeSvg(file.buffer) : this.normalizeRaster(file.buffer);
  }

  private isSvg(file: UploadedLogoFile): boolean {
    if (file.mimetype === 'image/svg+xml') return true;
    if (/\.svg$/i.test(file.originalname)) return true;
    // Браузер мог прислать octet-stream — контент-сниф: корень <svg в первом килобайте.
    return file.buffer.subarray(0, 1024).toString('utf8').toLowerCase().includes('<svg');
  }

  private normalizeSvg(input: Buffer): LogoBlob {
    if (input.length > MAX_SVG_BYTES) {
      throw new BadRequestException('SVG слишком большой (максимум 512 КБ)');
    }
    const clean = getSvgPurifier().sanitize(input.toString('utf8'), {
      USE_PROFILES: { svg: true, svgFilters: true },
      // foreignObject встраивает HTML (вектор XSS), script — активный контент. Обработчики on* и
      // опасные протоколы DOMPurify снимает сам. Внутренние ссылки (url(#id), <use href="#id"))
      // сохраняются; внешние подресурсы не грузятся в <img>-режиме и режутся CSP на отдаче.
      FORBID_TAGS: ['script', 'foreignObject'],
    });
    if (!/<svg[\s>]/i.test(clean)) {
      throw new BadRequestException('Файл не является корректным SVG');
    }
    const bytes = Buffer.from(clean, 'utf8');
    return { bytes, mime: 'image/svg+xml', hash: this.hash(bytes) };
  }

  private async normalizeRaster(input: Buffer): Promise<LogoBlob> {
    let bytes: Buffer;
    try {
      bytes = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .resize({
          width: MAX_DIMENSION_PX,
          height: MAX_DIMENSION_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png() // нормализуем в PNG — сохраняет прозрачность логотипа
        .toBuffer();
    } catch (err) {
      this.logger.warn(`Logo raster processing failed: ${errMsg(err)}`);
      throw new BadRequestException(
        'Не удалось обработать изображение (поддерживаются PNG, JPEG, WebP, SVG)',
      );
    }
    return { bytes, mime: 'image/png', hash: this.hash(bytes) };
  }

  private hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}

/**
 * Пишет логотип в HTTP-ответ с безопасными заголовками. Логотип (особенно SVG) — недоверенный
 * контент: nosniff запрещает угадывание типа, строгий CSP + sandbox глушат любой активный контент
 * и подресурсы на случай прямого открытия URL (вне <img>). ETag/Cache-Control задаёт вызывающий.
 */
export function sendLogoResponse(res: Response, blob: LogoBlob, cacheControl: string): void {
  res.setHeader('Content-Type', blob.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('ETag', `"${blob.hash}"`);
  res.setHeader('Cache-Control', cacheControl);
  res.send(blob.bytes);
}
