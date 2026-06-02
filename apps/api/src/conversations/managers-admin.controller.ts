import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { ConversationsService } from './conversations.service';
import { ManagerLinkService } from './manager-link.service';

/**
 * Админские эндпоинты привязки менеджерского Telegram (JWT + роль ADMIN).
 * Используются страницей менеджера в админке.
 */
@Controller('managers')
@Roles(UserRole.ADMIN)
export class ManagersAdminController {
  constructor(
    private linkService: ManagerLinkService,
    private conversations: ConversationsService,
  ) {}

  @Post(':userId/telegram-link-token')
  createLinkToken(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.linkService.createToken(userId);
  }

  @Delete(':userId/telegram-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.conversations.unlinkManager(userId);
  }
}
