import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { TelegramUsersService } from './telegram-users.service';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';
import { FindTelegramUsersQueryDto } from './dto/find-telegram-users-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('telegram-users')
export class TelegramUsersController {
  constructor(private service: TelegramUsersService) {}

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

  @Post('register')
  register(@Body() dto: RegisterTelegramUserDto) {
    return this.service.register(dto);
  }

  @Get(':telegramId')
  async findByTelegramId(@Param('telegramId', ParseIntPipe) telegramId: number) {
    const user = await this.service.findByTelegramId(telegramId);
    if (!user) throw new NotFoundException('Telegram user not found');
    return user;
  }
}
