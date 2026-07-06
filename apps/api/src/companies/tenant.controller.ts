import { Controller, Get, Headers, NotFoundException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CompanyTheme } from '../common/tenant/company-theme';
import {
  CompanyAssetKind,
  CompanyAssetService,
  sendAssetResponse,
} from './company-asset.service';
import { CompaniesService } from './companies.service';

/**
 * Публичный резолв брендинга тенанта по домену — для темизации admin-web ещё до логина. Открыт
 * (`@Public()`): корневой layout admin-web дёргает его на каждый рендер по хосту запроса. Отдаёт
 * тему, версии логотипа и favicon, флаг `known` (домен привязан к какой-то компании?) — но НЕ имя
 * компании/токены/список тенантов (имена не светим). Флаг `known` нужен строгому режиму admin-web
 * (env UNKNOWN_TENANT_BEHAVIOR=404): по known=false админка отдаёт 404 вместо fallback на дефолт.
 * Сами картинки — отдельными эндпоинтами (`GET /tenant/logo`, `/tenant/favicon`).
 */
@Controller('tenant')
export class TenantController {
  constructor(
    private companiesService: CompaniesService,
    private assetService: CompanyAssetService,
  ) {}

  @Public()
  @Get('theme')
  async theme(@Query('domain') domain?: string): Promise<{
    theme: CompanyTheme;
    logoVersion: string | null;
    faviconVersion: string | null;
    known: boolean;
  }> {
    return this.companiesService.resolveBrandingByDomain(domain);
  }

  /**
   * Логотип тенанта картинкой (для шапки/входа admin-web). Компания резолвится по домену: явный
   * `?domain=` либо заголовок `x-tenant-host` (его проставляет прокси admin-web). Нет логотипа →
   * 404 (фронт показывает дефолтную марку). immutable-кэш безопасен: URL несёт `?v=<hash>`.
   */
  @Public()
  @Get('logo')
  logo(
    @Res() res: Response,
    @Query('domain') domain?: string,
    @Headers('x-tenant-host') tenantHost?: string,
  ): Promise<void> {
    return this.serveAsset(res, 'logo', domain ?? tenantHost);
  }

  /** Favicon тенанта картинкой (для <link rel="icon"> admin-web). Резолв и кэш — как у логотипа. */
  @Public()
  @Get('favicon')
  favicon(
    @Res() res: Response,
    @Query('domain') domain?: string,
    @Headers('x-tenant-host') tenantHost?: string,
  ): Promise<void> {
    return this.serveAsset(res, 'favicon', domain ?? tenantHost);
  }

  private async serveAsset(res: Response, kind: CompanyAssetKind, domain?: string): Promise<void> {
    const companyId = await this.companiesService.resolveCompanyIdByDomain(domain);
    const blob = await this.assetService.getAsset(companyId, kind);
    if (!blob) throw new NotFoundException(`${kind} not found`);
    sendAssetResponse(res, blob, 'public, max-age=31536000, immutable');
  }
}
