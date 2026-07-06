import { Controller, Get, Headers, NotFoundException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CompanyTheme } from '../common/tenant/company-theme';
import { CompanyLogoService, sendLogoResponse } from './company-logo.service';
import { CompaniesService } from './companies.service';

/**
 * Публичный резолв брендинга тенанта по домену — для темизации admin-web ещё до логина. Открыт
 * (`@Public()`): корневой layout admin-web дёргает его на каждый рендер по хосту запроса. Отдаёт
 * ТОЛЬКО тему и версию логотипа (не имя компании/не токены/не список тенантов) — имена не светим.
 * Сам логотип — отдельной картинкой (`GET /tenant/logo`), чтобы шапка/логин показывали его в <img>.
 */
@Controller('tenant')
export class TenantController {
  constructor(
    private companiesService: CompaniesService,
    private logoService: CompanyLogoService,
  ) {}

  @Public()
  @Get('theme')
  async theme(
    @Query('domain') domain?: string,
  ): Promise<{ theme: CompanyTheme; logoVersion: string | null }> {
    return this.companiesService.resolveBrandingByDomain(domain);
  }

  /**
   * Логотип тенанта картинкой (для шапки/входа admin-web). Компания резолвится по домену: явный
   * `?domain=` либо заголовок `x-tenant-host` (его проставляет прокси admin-web). Нет логотипа →
   * 404 (фронт показывает дефолтную марку). immutable-кэш безопасен: URL несёт `?v=<hash>`.
   */
  @Public()
  @Get('logo')
  async logo(
    @Res() res: Response,
    @Query('domain') domain?: string,
    @Headers('x-tenant-host') tenantHost?: string,
  ): Promise<void> {
    const companyId = await this.companiesService.resolveCompanyIdByDomain(domain ?? tenantHost);
    const blob = await this.logoService.getLogo(companyId);
    if (!blob) throw new NotFoundException('Logo not found');
    sendLogoResponse(res, blob, 'public, max-age=31536000, immutable');
  }
}
