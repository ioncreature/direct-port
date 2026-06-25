import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiClientService } from '../api-client/api-client.service';
import { ClientAuthGuard } from '../auth/client-auth.guard';
import { ClientProfile } from '../auth/client-token.service';
import { CurrentClient } from '../auth/current-client.decorator';
import { CreateTopUpDto } from './dto/create-top-up.dto';
import { PortalQueryDto } from './dto/portal-query.dto';

/**
 * Client-facing витрина кабинета (Ф1, read-only). Все ресурсы скоупятся по accountId
 * из проверенного client-JWT (CurrentClient), который и уходит в api в путь запроса.
 */
@Controller('client')
@UseGuards(ClientAuthGuard)
export class PortalController {
  constructor(private api: ApiClientService) {}

  /** Профиль (из токена) + актуальный баланс. */
  @Get('me')
  async me(@CurrentClient() client: ClientProfile) {
    const { balance } = await this.api.getBalance(client.accountId);
    return {
      telegramUserId: client.telegramUserId,
      name: client.name,
      username: client.username,
      photoUrl: client.photoUrl,
      balance,
    };
  }

  @Get('transactions')
  transactions(@CurrentClient() client: ClientProfile, @Query() query: PortalQueryDto) {
    return this.api.getTransactions(client.accountId, { page: query.page, limit: query.limit });
  }

  @Get('documents')
  documents(@CurrentClient() client: ClientProfile, @Query() query: PortalQueryDto) {
    return this.api.getDocuments(client.accountId, query);
  }

  @Get('documents/:id')
  document(@CurrentClient() client: ClientProfile, @Param('id') id: string) {
    return this.api.getDocument(client.accountId, id);
  }

  @Get('packages')
  packages() {
    return this.api.getPackages();
  }

  @Post('topups')
  createTopUp(@CurrentClient() client: ClientProfile, @Body() dto: CreateTopUpDto) {
    // telegramUserId берётся из проверенного JWT, не из тела — клиент не подменит автора.
    return this.api.createTopUp(client.accountId, {
      packageKey: dto.packageKey,
      telegramUserId: client.telegramUserId,
    });
  }

  @Get('topups')
  topUps(@CurrentClient() client: ClientProfile, @Query() query: PortalQueryDto) {
    return this.api.getTopUps(client.accountId, { page: query.page, limit: query.limit });
  }

  @Post('topups/:id/cancel')
  cancelTopUp(@CurrentClient() client: ClientProfile, @Param('id') id: string) {
    return this.api.cancelTopUp(client.accountId, id);
  }

  @Get('documents/:id/download')
  async download(
    @CurrentClient() client: ClientProfile,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType, contentDisposition } = await this.api.downloadDocument(
      client.accountId,
      id,
    );
    res.set({ 'Content-Type': contentType, 'Content-Disposition': contentDisposition });
    res.send(buffer);
  }
}
