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
import { ClientBalanceService } from '../balance/client-balance.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Actor } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { AdjustDepositDto } from './dto/adjust-deposit.dto';
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
    private clientBalance: ClientBalanceService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query() query: FindTelegramUsersQueryDto, @CurrentUser() actor: Actor) {
    return this.service.findAll(query, actor);
  }

  /** Автокомплит клиентов для привязки к лиду (доступен и менеджеру-customs). */
  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  search(@Query('q') q: string, @CurrentUser() actor: Actor) {
    return this.service.search(q ?? '', actor);
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

  /** Ручное пополнение/корректировка депозита клиента (баланс в обработанных позициях). */
  @Post('by-id/:id/deposit')
  @Roles(UserRole.ADMIN)
  async adjustDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustDepositDto,
    @CurrentUser() actor: Actor,
  ) {
    const billingAccountId = await this.service.assertAccess(id, actor);
    return this.clientBalance.adjust(billingAccountId, dto.amount, {
      actorUserId: actor.id,
      comment: dto.comment,
    });
  }

  /** История операций по депозиту клиента (пополнения/списания/корректировки). */
  @Get('by-id/:id/deposit-transactions')
  @Roles(UserRole.ADMIN)
  async depositTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() actor: Actor,
  ) {
    const billingAccountId = await this.service.assertAccess(id, actor);
    return this.clientBalance.listTransactions(billingAccountId, {
      page: query.page,
      limit: query.limit,
    });
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
    return this.service.updateLanguage(telegramId, dto.language, dto.companyId);
  }

  @Get(':telegramId')
  @Internal()
  async findByTelegramId(
    @Param('telegramId', ParseIntPipe) telegramId: number,
    @Query('companyId') companyId?: string,
  ) {
    const user = await this.service.findByTelegramId(telegramId, companyId);
    if (!user) throw new NotFoundException('Telegram user not found');
    return user;
  }
}
