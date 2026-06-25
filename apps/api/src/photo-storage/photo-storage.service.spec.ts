import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import type { DocumentPhoto } from '../database/entities/document-photo.entity';
import { PhotoStorageService, type ProductPhotoInput } from './photo-storage.service';

/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

function makeRepo() {
  const created: DocumentPhoto[] = [];
  const repo: Partial<Repository<DocumentPhoto>> = {
    create: jest.fn().mockImplementation((data) => data as DocumentPhoto),
    save: jest.fn().mockImplementation(async (rows: DocumentPhoto[]) => {
      created.push(...rows);
      return rows;
    }),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
  return { repo, created };
}

describe('PhotoStorageService', () => {
  it('пропускает картинки с anchor вне товарных строк (unattached)', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);
    const png = await makePng(300, 300);
    const images: ProductPhotoInput[] = [
      { rowIndex: 5, bytes: png }, // в dataRows
      { rowIndex: 99, bytes: png }, // не в dataRows
    ];

    const refs = await service.savePhotos('doc-1', images, [5, 6, 7]);

    expect(refs).toHaveLength(1);
    expect(refs[0].productIndex).toBe(0); // 5 → индекс 0 в [5,6,7]
    expect(created).toHaveLength(1);
    expect(created[0].rowIndex).toBe(0);
  });

  it('ресайзит большие картинки до ≤1024px по большей стороне', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);
    const png = await makePng(2000, 1500); // больше лимита
    const images: ProductPhotoInput[] = [{ rowIndex: 5, bytes: png }];

    await service.savePhotos('doc-1', images, [5]);

    expect(created).toHaveLength(1);
    expect(created[0].mimeType).toBe('image/jpeg');
    expect(created[0].widthPx).toBeLessThanOrEqual(1024);
    expect(created[0].heightPx).toBeLessThanOrEqual(1024);
    expect(created[0].finalSizeBytes).toBeLessThan(created[0].originalSizeBytes!);
  });

  it('маленькие картинки не апскейлит', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);
    const png = await makePng(300, 200);
    const images: ProductPhotoInput[] = [{ rowIndex: 5, bytes: png }];

    await service.savePhotos('doc-1', images, [5]);

    expect(created[0].widthPx).toBe(300);
    expect(created[0].heightPx).toBe(200);
  });

  it('хеш sha256 считается от итоговых байтов и попадает в ref', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);
    const png = await makePng(400, 400);

    const refs = await service.savePhotos('doc-1', [{ rowIndex: 5, bytes: png }], [5]);

    expect(refs[0].hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash('sha256').update(created[0].bytes).digest('hex');
    expect(refs[0].hash).toBe(expected);
  });

  it('пустой images массив — никаких побочных эффектов', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);

    const refs = await service.savePhotos('doc-1', [], [1, 2, 3]);

    expect(refs).toEqual([]);
    expect(created).toHaveLength(0);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('одна и та же картинка в разных строках — два ref-а с одинаковым hash', async () => {
    const { repo, created } = makeRepo();
    const service = new PhotoStorageService(repo as Repository<DocumentPhoto>);
    const png = await makePng(400, 400);

    const refs = await service.savePhotos(
      'doc-1',
      [
        { rowIndex: 5, bytes: png },
        { rowIndex: 6, bytes: png },
      ],
      [5, 6],
    );

    expect(refs).toHaveLength(2);
    expect(refs[0].hash).toBe(refs[1].hash);
    expect(refs[0].productIndex).toBe(0);
    expect(refs[1].productIndex).toBe(1);
    expect(created).toHaveLength(2);
  });
});
