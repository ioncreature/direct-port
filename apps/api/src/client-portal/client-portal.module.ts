import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceModule } from '../balance/balance.module';
import { Document } from '../database/entities/document.entity';
import { DocumentsModule } from '../documents/documents.module';
import { TelegramUsersModule } from '../telegram-users/telegram-users.module';
import { TopUpModule } from '../top-up/top-up.module';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';

/**
 * Личный кабинет клиента — внутренний (X-Internal-Key) client-scoped API для client-bff.
 * Тонкий слой поверх уже готовых сервисов: TelegramUsersService (резолв/регистрация),
 * ClientBalanceService (баланс/журнал), ExcelExportService (выгрузка результата),
 * DocumentsService (self-service загрузка, Ф3) и TopUpService (пополнение, Ф2).
 * Собственного writer'а баланса не заводит — движение по балансу только через api.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    BalanceModule,
    TelegramUsersModule,
    DocumentsModule,
    TopUpModule,
  ],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
})
export class ClientPortalModule {}
