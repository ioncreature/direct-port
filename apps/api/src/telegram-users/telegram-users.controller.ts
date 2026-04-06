import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TelegramUsersService } from './telegram-users.service';
import { RegisterTelegramUserDto } from './dto/register-telegram-user.dto';

@Controller('telegram-users')
export class TelegramUsersController {
  constructor(private service: TelegramUsersService) {}

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
