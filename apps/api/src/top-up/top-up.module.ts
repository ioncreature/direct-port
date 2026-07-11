import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceModule } from '../balance/balance.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ManagerNotifyModule } from '../conversations/manager-notify.module';
import { BillingAccount } from '../database/entities/billing-account.entity';
import { TopUpRequest } from '../database/entities/top-up-request.entity';
import { TelegramUsersModule } from '../telegram-users/telegram-users.module';
import { ManagerTopUpController } from './manager-top-up.controller';
import { TopUpService } from './top-up.service';

/**
 * Заявки на пополнение баланса (Ф2 кабинета). Зачисление кредитов делает
 * ClientBalanceService (единый writer баланса); здесь — жизненный цикл заявок,
 * подтверждение менеджером и уведомления. Client-facing эндпоинты — в ClientPortal
 * (импортирует этот модуль ради TopUpService); manager-facing — здесь.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TopUpRequest, BillingAccount]),
    BalanceModule,
    ManagerNotifyModule,
    ConversationsModule,
    TelegramUsersModule,
  ],
  controllers: [ManagerTopUpController],
  providers: [TopUpService],
  exports: [TopUpService],
})
export class TopUpModule {}
