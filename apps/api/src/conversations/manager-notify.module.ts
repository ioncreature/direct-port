import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { ManagerNotifyService } from './manager-notify.service';

/**
 * Лёгкий модуль с ManagerNotifyService. Импортируется и в DocumentsModule
 * (для ветвления уведомлений по source), и в ConversationsModule — без цикла.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    BullModule.registerQueue({ name: 'manager-notifications' }),
  ],
  providers: [ManagerNotifyService],
  exports: [ManagerNotifyService],
})
export class ManagerNotifyModule {}
