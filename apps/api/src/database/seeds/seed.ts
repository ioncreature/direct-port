import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Company } from '../entities/company.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { TnVedCode } from '../entities/tn-ved-code.entity';
import { User, UserRole } from '../entities/user.entity';
import { TN_VED_SAMPLES } from './tn-ved-samples';

config();

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://directport:directport@localhost:5434/directport',
  entities: [User, Company, RefreshToken, TnVedCode],
});

async function seed() {
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const tnVedRepo = dataSource.getRepository(TnVedCode);

  // Seed root super-admin (глобальный администратор платформы, company_id = NULL).
  const existing = await userRepo.findOne({ where: { email: 'admin@directport.ru' } });
  if (!existing) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await userRepo.save(
      userRepo.create({
        email: 'admin@directport.ru',
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        companyId: null,
      }),
    );
    console.log('Super admin user created: admin@directport.ru / admin123');
  } else {
    console.log('Admin user already exists');
  }

  // Seed TN VED codes
  for (const item of TN_VED_SAMPLES) {
    const exists = await tnVedRepo.findOne({ where: { code: item.code! } });
    if (!exists) {
      await tnVedRepo.save(tnVedRepo.create(item));
    }
  }
  console.log(`Seeded ${TN_VED_SAMPLES.length} TN VED codes`);

  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
