import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ErrorCode } from '../common/error-codes';
import { UserRole } from '../database/entities/user.entity';
import { ASSET_UPLOAD } from './asset-upload';
import {
  ASSET_KINDS,
  CompanyAssetKind,
  CompanyAssetService,
  sendAssetResponse,
} from './company-asset.service';

/**
 * Self-service управление брендинговыми ассетами компании (только super_admin): загрузка/замена,
 * снятие и превью логотипа и favicon (`:asset` ∈ logo|favicon). Статический префикс `assets/` —
 * чтобы `:asset` не перехватывал соседний суб-ресурс `companies/:id/bots`. Растровые нормализуются
 * в PNG, SVG — санитайзится. Публичная отдача по домену (для admin-web) — в TenantController.
 */
@Controller('companies/:companyId/assets')
@Roles(UserRole.SUPER_ADMIN)
export class CompanyAssetController {
  constructor(private assets: CompanyAssetService) {}

  @Put(':asset')
  @UseInterceptors(FileInterceptor('file', ASSET_UPLOAD))
  async set(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('asset', new ParseEnumPipe(ASSET_KINDS)) asset: CompanyAssetKind,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({ code: ErrorCode.FILE_REQUIRED, message: 'Файл не передан' });
    }
    return this.assets.setAsset(companyId, asset, file);
  }

  @Delete(':asset')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('asset', new ParseEnumPipe(ASSET_KINDS)) asset: CompanyAssetKind,
  ) {
    return this.assets.removeAsset(companyId, asset);
  }

  /** Превью для страницы компании. no-cache: super_admin сразу видит только что загруженную замену. */
  @Get(':asset')
  async preview(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('asset', new ParseEnumPipe(ASSET_KINDS)) asset: CompanyAssetKind,
    @Res() res: Response,
  ) {
    const blob = await this.assets.getAsset(companyId, asset);
    if (!blob) throw new NotFoundException(`${asset} not found`);
    sendAssetResponse(res, blob, 'private, no-cache');
  }
}
