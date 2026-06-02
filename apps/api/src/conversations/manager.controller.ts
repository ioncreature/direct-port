import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Internal } from '../auth/decorators/internal.decorator';
import { ConversationsService } from './conversations.service';
import { ManagerActionDto } from './dto/manager-action.dto';
import { ManagerLinkDto } from './dto/manager-link.dto';
import { ManagerMessageDto } from './dto/manager-message.dto';

/**
 * Эндпоинты для manager-bot (auth ТОЛЬКО по X-Internal-Key). Менеджер
 * идентифицируется по managerTelegramId → User (резолв в ConversationsService).
 */
@Controller('manager')
export class ManagerController {
  constructor(private conversations: ConversationsService) {}

  @Post('link')
  @Internal()
  link(@Body() dto: ManagerLinkDto) {
    return this.conversations.linkManager(dto.token, String(dto.telegramId));
  }

  @Get('clients')
  @Internal()
  clients(@Query('managerTelegramId') managerTelegramId: string) {
    return this.conversations.listManagerClients(managerTelegramId);
  }

  @Post('clients/:clientId/claim')
  @Internal()
  claim(@Param('clientId', ParseUUIDPipe) clientId: string, @Body() dto: ManagerActionDto) {
    return this.conversations.claimByManagerTelegram(clientId, String(dto.managerTelegramId));
  }

  @Post('messages')
  @Internal()
  message(@Body() dto: ManagerMessageDto) {
    return this.conversations.managerReply(String(dto.managerTelegramId), dto.clientId, dto.text);
  }

  @Post('documents/:id/start')
  @Internal()
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManagerActionDto) {
    return this.conversations.startDocumentByManager(String(dto.managerTelegramId), id);
  }
}
