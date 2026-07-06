import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
import { Company } from '../database/entities/company.entity';
import { CompanyAssetService } from './company-asset.service';

function createService() {
  const companiesRepo = {
    existsBy: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as unknown as Repository<Company>;
  const service = new CompanyAssetService(companiesRepo);
  return { service, companiesRepo };
}

function pngBuffer(size = 4): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

// SVG-путь (санитайзинг через jsdom+DOMPurify) не покрываем здесь: jsdom тянет ESM-зависимость,
// которую jest не трансформирует. Санитайзинг проверяется в реальном Node отдельно.
describe('CompanyAssetService', () => {
  it('нормализует растровый логотип в PNG и пишет в logo-колонки', async () => {
    const { service, companiesRepo } = createService();
    const res = await service.setAsset('id', 'logo', {
      buffer: await pngBuffer(),
      mimetype: 'image/png',
      originalname: 'logo.png',
    });

    expect(res.hash).toMatch(/^[a-f0-9]{64}$/);
    const arg = (companiesRepo.update as jest.Mock).mock.calls[0][1];
    expect(arg.logoMime).toBe('image/png');
    expect(Buffer.isBuffer(arg.logoBytes)).toBe(true);
    expect(arg.logoHash).toBe(res.hash);
  });

  it('пишет favicon в favicon-колонки, не трогая logo', async () => {
    const { service, companiesRepo } = createService();
    const res = await service.setAsset('id', 'favicon', {
      buffer: await pngBuffer(),
      mimetype: 'image/png',
      originalname: 'fav.png',
    });

    const arg = (companiesRepo.update as jest.Mock).mock.calls[0][1];
    expect(arg.faviconMime).toBe('image/png');
    expect(Buffer.isBuffer(arg.faviconBytes)).toBe(true);
    expect(arg.faviconHash).toBe(res.hash);
    expect(arg.logoBytes).toBeUndefined();
  });

  it('setAsset на несуществующей компании бросает NotFound', async () => {
    const { service, companiesRepo } = createService();
    (companiesRepo.existsBy as jest.Mock).mockResolvedValue(false);

    await expect(
      service.setAsset('nope', 'logo', {
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        originalname: 'a.png',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(companiesRepo.update).not.toHaveBeenCalled();
  });

  it('removeAsset обнуляет колонки только запрошенного ассета', async () => {
    const { service, companiesRepo } = createService();
    await service.removeAsset('id', 'favicon');
    const arg = (companiesRepo.update as jest.Mock).mock.calls[0][1];
    expect(arg).toEqual({ faviconBytes: null, faviconMime: null, faviconHash: null });
  });
});
