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

/** Потолок пикселей входного растра для sharp/libvips — отсекает декомпрессионные бомбы. */
const MAX_INPUT_PIXELS = 50_000_000;
/** SVG — это разметка, «пиксельной бомбы» нет; ограничиваем размер файла. */
const MAX_SVG_BYTES = 512 * 1024;

/** Брендинговые ассеты тенанта, хранящиеся в companies одинаковым образом (bytes/mime/hash). */
export const ASSET_KINDS = ['logo', 'favicon'] as const;
export type CompanyAssetKind = (typeof ASSET_KINDS)[number];

/**
 * Колонки-хранилище и потолок ресайза для каждого ассета. logo показывается ≤48px в шапке/логине
 * (512px — с запасом на retina); favicon — иконка вкладки 16–64px (128px достаточно).
 */
const ASSET_FIELDS: Record<
  CompanyAssetKind,
  { bytes: keyof Company; mime: keyof Company; hash: keyof Company; maxDim: number }
> = {
  logo: { bytes: 'logoBytes', mime: 'logoMime', hash: 'logoHash', maxDim: 512 },
  favicon: { bytes: 'faviconBytes', mime: 'faviconMime', hash: 'faviconHash', maxDim: 128 },
};

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

export interface UploadedAssetFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface AssetBlob {
  bytes: Buffer;
  mime: string;
  hash: string;
}

/**
 * Брендинговые ассеты тенанта (логотип и favicon): нормализация загруженного файла (растровые →
 * PNG через sharp; SVG → санитайзинг DOMPurify), хранение в companies и чтение байтов для отдачи.
 * Один ассет каждого вида на компанию. Управление — только super_admin (CompanyAssetController);
 * публичная отдача по домену — TenantController.
 */
@Injectable()
export class CompanyAssetService {
  private logger = new Logger(CompanyAssetService.name);

  constructor(@InjectRepository(Company) private companiesRepo: Repository<Company>) {}

  /** Загрузить/заменить ассет: нормализовать, сохранить, вернуть новый hash (для cache-busting). */
  async setAsset(
    companyId: string,
    kind: CompanyAssetKind,
    file: UploadedAssetFile,
  ): Promise<{ hash: string }> {
    if (!(await this.companiesRepo.existsBy({ id: companyId }))) {
      throw new NotFoundException('Company not found');
    }
    const f = ASSET_FIELDS[kind];
    const blob = await this.normalize(file, f.maxDim);
    await this.companiesRepo.update(
      { id: companyId },
      { [f.bytes]: blob.bytes, [f.mime]: blob.mime, [f.hash]: blob.hash },
    );
    this.logger.log(`Set ${kind} for company ${companyId}: ${blob.mime}, ${blob.bytes.length} bytes`);
    return { hash: blob.hash };
  }

  /** Снять ассет компании (вернётся дефолт DirectPort). */
  async removeAsset(companyId: string, kind: CompanyAssetKind): Promise<void> {
    const f = ASSET_FIELDS[kind];
    const res = await this.companiesRepo.update(
      { id: companyId },
      { [f.bytes]: null, [f.mime]: null, [f.hash]: null },
    );
    if (!res.affected) throw new NotFoundException('Company not found');
  }

  /** Байты ассета (bytes-колонка select:false, читаем явным addSelect). null — ассета нет. */
  async getAsset(companyId: string, kind: CompanyAssetKind): Promise<AssetBlob | null> {
    const f = ASSET_FIELDS[kind];
    const row = await this.companiesRepo
      .createQueryBuilder('c')
      .select(`c.${f.mime}`, 'mime')
      .addSelect(`c.${f.hash}`, 'hash')
      .addSelect(`c.${f.bytes}`, 'bytes')
      .where('c.id = :id', { id: companyId })
      .andWhere(`c.${f.bytes} IS NOT NULL`)
      .getRawOne<{ mime: string; hash: string; bytes: Buffer }>();
    return row ? { bytes: row.bytes, mime: row.mime, hash: row.hash } : null;
  }

  private async normalize(file: UploadedAssetFile, maxDim: number): Promise<AssetBlob> {
    return this.isSvg(file) ? this.normalizeSvg(file.buffer) : this.normalizeRaster(file.buffer, maxDim);
  }

  private isSvg(file: UploadedAssetFile): boolean {
    if (file.mimetype === 'image/svg+xml') return true;
    if (/\.svg$/i.test(file.originalname)) return true;
    // Браузер мог прислать octet-stream — контент-сниф: корень <svg в первом килобайте.
    return file.buffer.subarray(0, 1024).toString('utf8').toLowerCase().includes('<svg');
  }

  private normalizeSvg(input: Buffer): AssetBlob {
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

  private async normalizeRaster(input: Buffer, maxDim: number): Promise<AssetBlob> {
    let bytes: Buffer;
    try {
      bytes = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
        .png() // нормализуем в PNG — сохраняет прозрачность
        .toBuffer();
    } catch (err) {
      this.logger.warn(`Asset raster processing failed: ${errMsg(err)}`);
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
 * Пишет ассет в HTTP-ответ с безопасными заголовками. Ассет (особенно SVG) — недоверенный контент:
 * nosniff запрещает угадывание типа, строгий CSP + sandbox глушат любой активный контент и
 * подресурсы на случай прямого открытия URL (вне <img>). ETag/Cache-Control задаёт вызывающий.
 */
export function sendAssetResponse(res: Response, blob: AssetBlob, cacheControl: string): void {
  res.setHeader('Content-Type', blob.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('ETag', `"${blob.hash}"`);
  res.setHeader('Cache-Control', cacheControl);
  res.send(blob.bytes);
}
