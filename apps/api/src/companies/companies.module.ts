import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyDomain } from '../database/entities/company-domain.entity';
import { Company } from '../database/entities/company.entity';
import { Document } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyAssetController } from './company-asset.controller';
import { CompanyAssetService } from './company-asset.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company, CompanyDomain, User, TelegramUser, Document])],
  controllers: [CompaniesController, CompanyAssetController, TenantController],
  providers: [CompaniesService, CompanyAssetService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
