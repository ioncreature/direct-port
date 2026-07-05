import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyDomain } from '../database/entities/company-domain.entity';
import { Company } from '../database/entities/company.entity';
import { Document } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company, CompanyDomain, User, TelegramUser, Document])],
  controllers: [CompaniesController, TenantController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
