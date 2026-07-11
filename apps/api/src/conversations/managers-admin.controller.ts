import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Actor } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { ConversationsService } from './conversations.service';
import { ManagerLinkService } from './manager-link.service';

/**
 * Админские эндпоинты привязки менеджерского Telegram (JWT + роль ADMIN).
 * Используются страницей менеджера в админке. Actor обязателен: и генерация токена,
 * и отвязка скоупятся по компании актора (assertSameCompany) — иначе админ одной
 * компании мог бы выпустить deep-link на менеджера чужой компании и захватить его
 * аккаунт (или отвязать чужого менеджера).
 */
@Controller('managers')
@Roles(UserRole.ADMIN)
export class ManagersAdminController {
  constructor(
    private linkService: ManagerLinkService,
    private conversations: ConversationsService,
  ) {}

  @Post(':userId/telegram-link-token')
  createLinkToken(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() actor: Actor) {
    return this.linkService.createToken(userId, actor);
  }

  @Delete(':userId/telegram-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() actor: Actor) {
    return this.conversations.unlinkManager(userId, actor);
  }
}
