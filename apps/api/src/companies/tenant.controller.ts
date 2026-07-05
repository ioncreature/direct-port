import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CompanyTheme } from '../common/tenant/company-theme';
import { CompaniesService } from './companies.service';

/**
 * Публичный резолв темы тенанта по домену — для темизации admin-web ещё до логина. Открыт
 * (`@Public()`): корневой layout admin-web дёргает его на каждый рендер по хосту запроса.
 * Отдаёт ТОЛЬКО тему (не имя компании/не токены/не список тенантов) — имена тенантов не светим.
 */
@Controller('tenant')
export class TenantController {
  constructor(private companiesService: CompaniesService) {}

  @Public()
  @Get('theme')
  async theme(@Query('domain') domain?: string): Promise<{ theme: CompanyTheme }> {
    return { theme: await this.companiesService.resolveThemeByDomain(domain) };
  }
}
