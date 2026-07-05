import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Actor, resolveCompanyScope } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  getStats(@CurrentUser() actor: Actor, @Query() query: DashboardStatsQueryDto) {
    return this.service.getStats({
      period: query.period,
      companyId: resolveCompanyScope(actor, query.companyId),
      // AI-расходы и число сотрудников — ADMIN-уровень: роль customs не видит
      // соответствующие разделы (/users, /ai-costs), дашборд зеркалит эту матрицу.
      // Allowlist, а не «не customs»: новая роль по умолчанию их не получит.
      includeAdminMetrics:
        actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN,
    });
  }
}
