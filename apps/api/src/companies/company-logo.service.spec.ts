import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
import { Company } from '../database/entities/company.entity';
import { CompanyLogoService } from './company-logo.service';

function createService() {
  const companiesRepo = {
    existsBy: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as unknown as Repository<Company>;
  const service = new CompanyLogoService(companiesRepo);
  return { service, companiesRepo };
}

// SVG-путь (санитайзинг через jsdom+DOMPurify) не покрываем здесь: jsdom тянет ESM-зависимость,
// которую jest не трансформирует. Санитайзинг проверяется в реальном Node отдельно.
describe('CompanyLogoService', () => {
  it('нормализует растровый логотип в PNG и сохраняет sha256', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const { service, companiesRepo } = createService();

    const res = await service.setLogo('id', {
      buffer: png,
      mimetype: 'image/png',
      originalname: 'logo.png',
    });

    expect(res.logoHash).toMatch(/^[a-f0-9]{64}$/);
    const arg = (companiesRepo.update as jest.Mock).mock.calls[0][1];
    expect(arg.logoMime).toBe('image/png');
    expect(Buffer.isBuffer(arg.logoBytes)).toBe(true);
    expect(arg.logoHash).toBe(res.logoHash);
  });

  it('setLogo на несуществующей компании бросает NotFound', async () => {
    const { service, companiesRepo } = createService();
    (companiesRepo.existsBy as jest.Mock).mockResolvedValue(false);

    await expect(
      service.setLogo('nope', {
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        originalname: 'a.png',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(companiesRepo.update).not.toHaveBeenCalled();
  });

  it('removeLogo обнуляет колонки логотипа', async () => {
    const { service, companiesRepo } = createService();
    await service.removeLogo('id');
    const arg = (companiesRepo.update as jest.Mock).mock.calls[0][1];
    expect(arg).toEqual({ logoBytes: null, logoMime: null, logoHash: null });
  });
});
