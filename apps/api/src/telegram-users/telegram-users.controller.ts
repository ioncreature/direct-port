import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Actor } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { FindTelegramUsersQueryDto } from './dto/find-telegram-users-query.dto';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';
import { UpdateLanguageDto } from './dto/update-language.dto';
import { ConversationsService } from '../conversations/conversations.service';
import { TelegramUsersService } from './telegram-users.service';

@Controller('telegram-users')
export class TelegramUsersController {
  constructor(
    private service: TelegramUsersService,
    private conversations: ConversationsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query() query: FindTelegramUsersQueryDto, @CurrentUser() actor: Actor) {
    return this.service.findAll(query, actor);
  }

  @Get('by-id/:id')
  @Roles(UserRole.ADMIN)
  findOneById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.findOneById(id, actor);
  }

  /** История переписки клиента с менеджерами (read-only для админки). */
  @Get('by-id/:id/messages')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async messages(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    await this.service.assertAccess(id, actor);
    return this.conversations.listByClient(id);
  }

  @Post('register')
  @Internal()
  register(@Body() dto: RegisterTelegramUserDto) {
    return this.service.register(dto);
  }

  @Patch(':telegramId/language')
  @Internal()
  updateLanguage(
    @Param('telegramId') telegramId: string,
    @Body() dto: UpdateLanguageDto,
  ) {
    return this.service.updateLanguage(telegramId, dto.language);
  }

  @Get(':telegramId')
  @Internal()
  async findByTelegramId(@Param('telegramId', ParseIntPipe) telegramId: number) {
    const user = await this.service.findByTelegramId(telegramId);
    if (!user) throw new NotFoundException('Telegram user not found');
    return user;
  }
}
