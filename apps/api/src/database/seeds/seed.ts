import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { TnVedCode } from '../entities/tn-ved-code.entity';
import { User, UserRole } from '../entities/user.entity';

config();

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://directport:directport@localhost:5434/directport',
  entities: [User, RefreshToken, TnVedCode],
});

const tnVedSamples: Partial<TnVedCode>[] = [
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

async function seed() {
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const tnVedRepo = dataSource.getRepository(TnVedCode);

  // Seed admin user
  const existing = await userRepo.findOne({ where: { email: 'admin@directport.ru' } });
  if (!existing) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await userRepo.save(
      userRepo.create({
        email: 'admin@directport.ru',
        passwordHash,
        role: UserRole.ADMIN,
      }),
    );
    console.log('Admin user created: admin@directport.ru / admin123');
  } else {
    console.log('Admin user already exists');
  }

  // Seed TN VED codes
  for (const item of tnVedSamples) {
    const exists = await tnVedRepo.findOne({ where: { code: item.code! } });
    if (!exists) {
      await tnVedRepo.save(tnVedRepo.create(item));
    }
  }
  console.log(`Seeded ${tnVedSamples.length} TN VED codes`);

  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
