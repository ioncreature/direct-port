import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepositTransaction } from '../database/entities/deposit-transaction.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { ClientBalanceService } from './client-balance.service';

/**
 * Депозит клиента (баланс в обработанных позициях). Экспортирует ClientBalanceService
 * для DocumentsModule (проверка/списание в pipeline) и TelegramUsersModule (ручные
 * пополнения и история операций из админки).
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser, DepositTransaction])],
  providers: [ClientBalanceService],
  exports: [ClientBalanceService],
})
export class BalanceModule {}
