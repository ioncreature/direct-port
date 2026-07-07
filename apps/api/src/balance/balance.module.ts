import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingAccount } from '../database/entities/billing-account.entity';
import { DepositTransaction } from '../database/entities/deposit-transaction.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { BalanceReconciliationSweep } from './balance-reconciliation.sweep';
import { ClientBalanceService } from './client-balance.service';

/**
 * Депозит клиента (баланс в обработанных позициях). Экспортирует ClientBalanceService
 * для DocumentsModule (проверка/списание в pipeline) и TelegramUsersModule (ручные
 * пополнения и история операций из админки). BalanceReconciliationSweep — фоновая
 * сверка расхождений best-effort-списаний.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser, DepositTransaction, BillingAccount])],
  providers: [ClientBalanceService, BalanceReconciliationSweep],
  exports: [ClientBalanceService],
})
export class BalanceModule {}
