import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
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
import { CompanyLogoService, sendLogoResponse } from './company-logo.service';
import { LOGO_UPLOAD } from './logo-upload';

/**
 * Self-service управление логотипом компании (только super_admin): загрузка/замена, снятие и
 * превью текущего логотипа для страницы компании. Растровые нормализуются в PNG, SVG —
 * санитайзится. Публичная отдача по домену (для шапки/логина) — в TenantController.
 */
@Controller('companies/:companyId/logo')
@Roles(UserRole.SUPER_ADMIN)
export class CompanyLogoController {
  constructor(private logo: CompanyLogoService) {}

  @Put()
  @UseInterceptors(FileInterceptor('file', LOGO_UPLOAD))
  async set(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({ code: ErrorCode.FILE_REQUIRED, message: 'Файл не передан' });
    }
    return this.logo.setLogo(companyId, file);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.logo.removeLogo(companyId);
  }

  /** Превью для страницы компании. no-cache: super_admin сразу видит только что загруженную замену. */
  @Get()
  async preview(@Param('companyId', ParseUUIDPipe) companyId: string, @Res() res: Response) {
    const blob = await this.logo.getLogo(companyId);
    if (!blob) throw new NotFoundException('Logo not found');
    sendLogoResponse(res, blob, 'private, no-cache');
  }
}
