import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TelegramUsersService } from './telegram-users.service';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('telegram-users')
export class TelegramUsersController {
  constructor(private service: TelegramUsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.service.findAll();
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
