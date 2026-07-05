import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** Окна статистики дашборда: последние 7/30/365 дней (включая сегодняшний). */
export const DASHBOARD_PERIODS = ['week', 'month', 'year'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export class DashboardStatsQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period: DashboardPeriod = 'month';

  /** Фильтр по компании — учитывается только для super_admin. */
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;
}
