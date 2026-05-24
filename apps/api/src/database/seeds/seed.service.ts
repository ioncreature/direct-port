import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { TnVedCode } from '../entities/tn-ved-code.entity';
import { User, UserRole } from '../entities/user.entity';
import { TN_VED_SAMPLES } from './tn-ved-samples';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(TnVedCode) private tnVedRepo: Repository<TnVedCode>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdmin();
    await this.seedTnVed();
  }

  private async seedAdmin() {
    const existing = await this.userRepo.findOne({ where: { email: 'admin@directport.ru' } });
    if (existing) return;

    const passwordHash = await bcrypt.hash('admin123', 10);
    await this.userRepo.save(
      this.userRepo.create({ email: 'admin@directport.ru', passwordHash, role: UserRole.ADMIN }),
    );
    this.logger.log('Created admin user: admin@directport.ru');
  }

  private async seedTnVed() {
    let created = 0;
    for (const item of TN_VED_SAMPLES) {
      const exists = await this.tnVedRepo.findOne({ where: { code: item.code! } });
      if (!exists) {
        await this.tnVedRepo.save(this.tnVedRepo.create(item));
        created++;
      }
    }
    if (created > 0) {
      this.logger.log(`Seeded ${created} TN VED codes`);
    }
  }
}
