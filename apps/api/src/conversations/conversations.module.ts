import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../database/entities/company.entity';
import { ConversationMessage } from '../database/entities/conversation-message.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { DocumentsModule } from '../documents/documents.module';
import { ConversationsService } from './conversations.service';
import { IntakeController } from './intake.controller';
import { ManagerController } from './manager.controller';
import { ManagerLinkService } from './manager-link.service';
import { ManagerNotifyModule } from './manager-notify.module';
import { ManagersAdminController } from './managers-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, ConversationMessage, TelegramUser, User]),
    BullModule.registerQueue({ name: 'client-bot-outgoing' }),
    DocumentsModule,
    ManagerNotifyModule,
  ],
  controllers: [IntakeController, ManagerController, ManagersAdminController],
  providers: [ConversationsService, ManagerLinkService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
