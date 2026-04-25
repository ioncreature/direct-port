import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// sharp — CommonJS-модуль; без esModuleInterop default-import ломается в runtime,
// а TS-namespace import не парсит Babel jest. Простой require обходит оба.
/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
import { errMsg } from '../common/errors';
import { DocumentPhoto } from '../database/entities/document-photo.entity';

const MAX_DIMENSION_PX = 1024;
const JPEG_QUALITY = 85;
const RESIZE_CONCURRENCY = 4;
/** Защита от OOM на патологических xlsx с тысячами embedded-картинок. */
const MAX_IMAGES_PER_DOC = 200;

export interface ProductPhotoInput {
  rowIndex: number;
  bytes: Buffer;
}

export interface SavedPhotoRef {
  productIndex: number;
  hash: string;
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
    if (images.length === 0) return [];

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
    // накопятся дубликаты от каждого запуска.
    if (rows.length > 0) {
      await this.repo.delete({ documentId });
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
  ): Promise<{ data: Buffer; width: number | null; height: number | null } | null> {
    try {
      const { data, info } = await sharp(bytes)
        .resize({
          width: MAX_DIMENSION_PX,
          height: MAX_DIMENSION_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });
      return { data, width: info?.width ?? null, height: info?.height ?? null };
    } catch (err) {
      this.logger.warn(`sharp processing failed: ${errMsg(err)}`);
      return null;
    }
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
}
