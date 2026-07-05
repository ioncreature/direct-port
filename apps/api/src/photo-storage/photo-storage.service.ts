import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
// sharp — CommonJS-модуль; без esModuleInterop default-import ломается в runtime,
// а TS-namespace import не парсит Babel jest. Простой require обходит оба.
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
import { errMsg } from '../common/errors';
import { DocumentPhoto } from '../database/entities/document-photo.entity';

const MAX_DIMENSION_PX = 1024;
const JPEG_QUALITY = 85;
/** Миниатюры для выходного Excel и таблиц админки: мелкие и дешёвые (~5–8 КБ). */
const THUMB_DIMENSION_PX = 120;
const THUMB_JPEG_QUALITY = 70;
const RESIZE_CONCURRENCY = 4;
/** Защита от OOM на патологических xlsx с тысячами embedded-картинок. */
const MAX_IMAGES_PER_DOC = 200;
/**
 * Потолок пикселей на входное изображение для sharp/libvips. Фото товаров из xlsx —
 * единицы мегапикселей; 50 МП щедро для легитимных, но отсекает декомпрессионные
 * бомбы (картинка с гигантским заявленным разрешением, разворачивающаяся при
 * декодировании в гигабайты raw-bitmap). Дефолт libvips — 268 МП, под бомбу велик.
 */
const MAX_INPUT_PIXELS = 50_000_000;

export interface ProductPhotoInput {
  rowIndex: number;
  bytes: Buffer;
}

export interface SavedPhotoRef {
  productIndex: number;
  hash: string;
}

/** Миниатюра первого фото строки (photoIds[0]) + список всех фото строки. */
export interface RowPhotoThumbnail {
  rowIndex: number;
  photoIds: string[];
  imageHash: string;
  bytes: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class PhotoStorageService {
  private logger = new Logger(PhotoStorageService.name);

  constructor(
    @InjectRepository(DocumentPhoto) private repo: Repository<DocumentPhoto>,
  ) {}

  /**
   * @param dataRowIndices — 0-indexed excel rows, попавшие в parsedData. Фото
   *   с anchor вне товарной строки (заголовки, итоги, свободная зона) молча
   *   отбрасываются — лучше без фото, чем привязать его к неверной строке.
   */
  async savePhotos(
    documentId: string,
    images: ProductPhotoInput[],
    dataRowIndices: number[],
  ): Promise<SavedPhotoRef[]> {
    if (images.length === 0) {
      // Повторный парс без фото обязан стереть записи прошлого запуска: их rowIndex
      // привязан к старому parsedData и после reparse указывает на другие строки.
      await this.deleteForDocument(documentId);
      return [];
    }

    const rowToProduct = new Map<number, number>();
    for (let i = 0; i < dataRowIndices.length; i++) {
      rowToProduct.set(dataRowIndices[i], i);
    }

    const attached: { productIndex: number; bytes: Buffer; originalSize: number }[] = [];
    let skippedUnattached = 0;
    for (const img of images) {
      const productIndex = rowToProduct.get(img.rowIndex);
      if (productIndex === undefined) {
        skippedUnattached++;
        continue;
      }
      attached.push({ productIndex, bytes: img.bytes, originalSize: img.bytes.length });
      if (attached.length >= MAX_IMAGES_PER_DOC) break;
    }
    const skippedOverflow = images.length - skippedUnattached - attached.length;

    const rows: DocumentPhoto[] = [];
    const refs: SavedPhotoRef[] = [];
    let sharpErrors = 0;
    for (let i = 0; i < attached.length; i += RESIZE_CONCURRENCY) {
      const batch = attached.slice(i, i + RESIZE_CONCURRENCY);
      const processed = await Promise.all(batch.map((a) => this.resizeOne(a.bytes)));
      for (let j = 0; j < batch.length; j++) {
        const result = processed[j];
        if (!result) {
          sharpErrors++;
          continue;
        }
        const { productIndex, originalSize } = batch[j];
        const hash = createHash('sha256').update(result.data).digest('hex');
        rows.push(
          this.repo.create({
            documentId,
            rowIndex: productIndex,
            imageHash: hash,
            mimeType: 'image/jpeg',
            bytes: result.data,
            widthPx: result.width,
            heightPx: result.height,
            originalSizeBytes: originalSize,
            finalSizeBytes: result.data.length,
          }),
        );
        refs.push({ productIndex, hash });
      }
    }

    // Идемпотентность для reparse: иначе при POST /:id/reprocess с парсингом
    // накопятся дубликаты от каждого запуска. Удаляем старые и при нуле новых —
    // иначе после повторного парса без валидных фото остаются записи прошлого
    // запуска, чьи rowIndex могут указывать на другие строки нового parsedData
    // (vision-retry подтверждал бы код по чужой фотографии).
    await this.deleteForDocument(documentId);
    if (rows.length > 0) {
      await this.repo.save(rows);
    }

    this.logger.log(
      `Saved ${rows.length} photos for document ${documentId}: ` +
        `${images.length} extracted, ${skippedUnattached} skipped (unattached), ` +
        `${skippedOverflow} skipped (over MAX_IMAGES_PER_DOC=${MAX_IMAGES_PER_DOC}), ` +
        `${sharpErrors} skipped (sharp errors)`,
    );

    return refs;
  }

  private async resizeOne(
    bytes: Buffer,
    maxDimension = MAX_DIMENSION_PX,
    quality = JPEG_QUALITY,
  ): Promise<{ data: Buffer; width: number | null; height: number | null } | null> {
    try {
      const { data, info } = await sharp(bytes, {
        // Произвольные изображения из xlsx клиента: ограничиваем размер декодируемого
        // bitmap (libvips — известный источник OOM на больших/вредоносных картинках)
        // и падаем на повреждённых, а не глотаем частично декодированное.
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: 'error',
      })
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });
      return { data, width: info?.width ?? null, height: info?.height ?? null };
    } catch (err) {
      this.logger.warn(`sharp processing failed: ${errMsg(err)}`);
      return null;
    }
  }

  /**
   * Миниатюры (≤120px) первых фото каждой строки документа. Не хранятся —
   * генерируются на лету из уже ресайзнутых 1024px-версий (осознанный компромисс:
   * при заметной нагрузке следующий шаг — персистентная колонка thumbBytes).
   * Одинаковые изображения (по imageHash) ресайзятся один раз.
   */
  async getRowThumbnails(documentId: string): Promise<RowPhotoThumbnail[]> {
    const meta: Pick<DocumentPhoto, 'id' | 'rowIndex'>[] = await this.repo.find({
      where: { documentId },
      select: ['id', 'rowIndex'],
      order: { rowIndex: 'ASC', createdAt: 'ASC' },
    });
    if (meta.length === 0) return [];
    const idsByRow = new Map<number, string[]>();
    for (const m of meta) {
      const ids = idsByRow.get(m.rowIndex);
      if (ids) ids.push(m.id);
      else idsByRow.set(m.rowIndex, [m.id]);
    }

    // BYTEA тянем только для первого фото каждой строки (photoIds[0]).
    const firstIds = [...idsByRow.values()].map((ids) => ids[0]);
    const firsts = await this.repo.find({ where: { id: In(firstIds) } });
    const firstById = new Map(firsts.map((p) => [p.id, p]));

    const uniques = [...new Map(firsts.map((p) => [p.imageHash, p])).values()];
    const thumbByHash = new Map<
      string,
      { data: Buffer; width: number | null; height: number | null } | null
    >();
    for (let i = 0; i < uniques.length; i += RESIZE_CONCURRENCY) {
      const batch = uniques.slice(i, i + RESIZE_CONCURRENCY);
      const resized = await Promise.all(
        batch.map((p) => this.resizeOne(p.bytes, THUMB_DIMENSION_PX, THUMB_JPEG_QUALITY)),
      );
      batch.forEach((p, j) => thumbByHash.set(p.imageHash, resized[j]));
    }

    const result: RowPhotoThumbnail[] = [];
    for (const [rowIndex, photoIds] of idsByRow) {
      const photo = firstById.get(photoIds[0]);
      const thumb = photo ? thumbByHash.get(photo.imageHash) : null;
      if (!photo || !thumb) continue; // битое фото — строка остаётся без миниатюры
      result.push({
        rowIndex,
        photoIds,
        imageHash: photo.imageHash,
        bytes: thumb.data,
        width: thumb.width ?? THUMB_DIMENSION_PX,
        height: thumb.height ?? THUMB_DIMENSION_PX,
      });
    }
    return result;
  }

  async getById(documentId: string, photoId: string): Promise<DocumentPhoto | null> {
    return this.repo.findOne({ where: { id: photoId, documentId } });
  }

  async deleteForDocument(documentId: string): Promise<void> {
    await this.repo.delete({ documentId });
  }

  async getByHash(documentId: string, hashes: string[]): Promise<DocumentPhoto[]> {
    if (hashes.length === 0) return [];
    return this.repo
      .createQueryBuilder('p')
      .where('p.document_id = :documentId', { documentId })
      .andWhere('p.image_hash IN (:...hashes)', { hashes })
      .getMany();
  }

  async getByDocument(documentId: string): Promise<DocumentPhoto[]> {
    return this.repo.find({
      where: { documentId },
      order: { rowIndex: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * По одному фото на каждую запрошенную строку (DISTINCT ON по rowIndex).
   * Используется vision-retry'ем, чтобы не таскать все BYTEA документа из БД,
   * когда нужны только несколько low-confidence строк.
   */
  async getFirstByRows(documentId: string, rowIndices: number[]): Promise<DocumentPhoto[]> {
    if (rowIndices.length === 0) return [];
    return this.repo
      .createQueryBuilder('p')
      .distinctOn(['p.row_index'])
      .where('p.document_id = :documentId', { documentId })
      .andWhere('p.row_index IN (:...rowIndices)', { rowIndices })
      .orderBy('p.row_index', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getMany();
  }
}
