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

  describe('getRowThumbnails', () => {
    /** Репо для чтения: 1-й find — meta без bytes, 2-й find — фото по id In(...). */
    function makeReadRepo(photos: DocumentPhoto[]) {
      const find = jest.fn().mockImplementation(async (opts: { select?: unknown; where?: { id?: { value: string[] } } }) => {
        if (opts?.select) return photos.map(({ id, rowIndex }) => ({ id, rowIndex }));
        const wanted = new Set(opts?.where?.id?.value ?? []);
        return photos.filter((p) => wanted.has(p.id));
      });
      return { find } as unknown as Repository<DocumentPhoto>;
    }

    async function makeStoredPhoto(
      id: string,
      rowIndex: number,
      hash: string,
      size = 800,
    ): Promise<DocumentPhoto> {
      const bytes = await sharp(await makePng(size, size))
        .jpeg()
        .toBuffer();
      return { id, documentId: 'doc-1', rowIndex, imageHash: hash, bytes } as DocumentPhoto;
    }

    it('отдаёт миниатюру ≤120px первого фото строки и все photoIds строки', async () => {
      const photos = [
        await makeStoredPhoto('p1', 0, 'hash-a'),
        await makeStoredPhoto('p2', 0, 'hash-b'),
        await makeStoredPhoto('p3', 2, 'hash-c'),
      ];
      const service = new PhotoStorageService(makeReadRepo(photos));

      const thumbs = await service.getRowThumbnails('doc-1');

      expect(thumbs).toHaveLength(2);
      expect(thumbs[0]).toMatchObject({ rowIndex: 0, photoIds: ['p1', 'p2'] });
      expect(thumbs[1]).toMatchObject({ rowIndex: 2, photoIds: ['p3'] });
      expect(thumbs[0].width).toBeLessThanOrEqual(120);
      expect(thumbs[0].height).toBeLessThanOrEqual(120);
      expect(thumbs[0].bytes.length).toBeLessThan(photos[0].bytes.length);
    });

    it('одинаковые изображения (hash) ресайзятся один раз', async () => {
      const shared = await makeStoredPhoto('p1', 0, 'same-hash');
      const photos = [shared, { ...shared, id: 'p2', rowIndex: 1 } as DocumentPhoto];
      const service = new PhotoStorageService(makeReadRepo(photos));
      const resizeSpy = jest.spyOn(
        service as unknown as { resizeOne: (...args: unknown[]) => unknown },
        'resizeOne',
      );

      const thumbs = await service.getRowThumbnails('doc-1');

      expect(thumbs).toHaveLength(2);
      expect(resizeSpy).toHaveBeenCalledTimes(1);
    });

    it('документ без фото — пустой список без запроса байтов', async () => {
      const repo = makeReadRepo([]);
      const service = new PhotoStorageService(repo);

      expect(await service.getRowThumbnails('doc-1')).toEqual([]);
      expect(repo.find).toHaveBeenCalledTimes(1); // только meta, без выборки BYTEA
    });

    it('битые байты — строка пропускается, остальные отдаются', async () => {
      const photos = [
        {
          id: 'p1',
          documentId: 'doc-1',
          rowIndex: 0,
          imageHash: 'broken',
          bytes: Buffer.from('not an image'),
        } as DocumentPhoto,
        await makeStoredPhoto('p2', 1, 'hash-ok'),
      ];
      const service = new PhotoStorageService(makeReadRepo(photos));

      const thumbs = await service.getRowThumbnails('doc-1');

      expect(thumbs).toHaveLength(1);
      expect(thumbs[0].rowIndex).toBe(1);
    });
  });
});
