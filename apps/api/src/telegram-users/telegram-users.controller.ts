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
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
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
  findAll(@Query() query: FindTelegramUsersQueryDto) {
    return this.service.findAll(query);
  }

  @Get('by-id/:id')
  @Roles(UserRole.ADMIN)
  findOneById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneById(id);
  }

  /** История переписки клиента с менеджерами (read-only для админки). */
  @Get('by-id/:id/messages')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  messages(@Param('id', ParseUUIDPipe) id: string) {
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
