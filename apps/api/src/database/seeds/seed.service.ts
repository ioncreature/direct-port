import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { TnVedCode } from '../entities/tn-ved-code.entity';
import { User, UserRole } from '../entities/user.entity';

const TN_VED_SAMPLES: Partial<TnVedCode>[] = [
  {
    code: '0201',
    description: 'Мясо крупного рогатого скота, свежее или охлажденное',
    unit: 'кг',
    dutyRate: 15,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '02',
    level: 2,
  },
  {
    code: '0901',
    description: 'Кофе, жареный или нежареный, с кофеином или без кофеина',
    unit: 'кг',
    dutyRate: 10,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '09',
    level: 2,
  },
  {
    code: '6109',
    description: 'Футболки, майки и прочие нательные фуфайки, трикотажные',
    unit: 'шт',
    dutyRate: 12.5,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '61',
    level: 2,
  },
  {
    code: '6110',
    description: 'Джемперы, пуловеры, кардиганы, жилеты и аналогичные изделия, трикотажные',
    unit: 'шт',
    dutyRate: 12.5,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '61',
    level: 2,
  },
  {
    code: '6203',
    description: 'Костюмы, комплекты, пиджаки, брюки мужские или для мальчиков',
    unit: 'шт',
    dutyRate: 12.5,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '62',
    level: 2,
  },
  {
    code: '8471',
    description:
      'Вычислительные машины и их блоки; магнитные или оптические считывающие устройства',
    unit: 'шт',
    dutyRate: 0,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '84',
    level: 2,
  },
  {
    code: '8517',
    description: 'Телефонные аппараты, включая смартфоны и прочие телефоны для сотовых сетей',
    unit: 'шт',
    dutyRate: 0,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '85',
    level: 2,
  },
  {
    code: '8528',
    description:
      'Мониторы и проекторы, не включающие в свой состав телевизионную приемную аппаратуру',
    unit: 'шт',
    dutyRate: 8,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '85',
    level: 2,
  },
  {
    code: '8703',
    description: 'Автомобили легковые и прочие моторные транспортные средства',
    unit: 'шт',
    dutyRate: 15,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '87',
    level: 2,
  },
  {
    code: '9403',
    description: 'Мебель прочая и ее части',
    unit: 'шт',
    dutyRate: 10.6,
    vatRate: 20,
    exciseRate: 0,
    parentCode: '94',
    level: 2,
  },
];

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
