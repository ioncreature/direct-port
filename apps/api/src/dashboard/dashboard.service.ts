import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INCOMPLETE_CALCULATION_STATUSES } from '../common/product-notes';
import type { TokenUsageMap } from '../common/token-usage';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { DocumentsService } from '../documents/documents.service';
import type { DashboardPeriod } from './dto/dashboard-stats-query.dto';

/** Окно в днях (включая сегодняшний) и гранулярность series: год смотрят помесячно. */
const PERIOD_CONFIG: Record<DashboardPeriod, { days: number; granularity: 'day' | 'month' }> = {
  week: { days: 7, granularity: 'day' },
  month: { days: 30, granularity: 'day' },
  year: { days: 365, granularity: 'month' },
};

/** Статусы, в которых документ дошёл до расчёта и resultData актуален. */
const COMPLETED_STATUSES = [DocumentStatus.PROCESSED, DocumentStatus.PROCESSED_WITH_ERRORS];

export interface DashboardSeriesPoint {
  /** YYYY-MM-DD (granularity=day) или YYYY-MM (granularity=month), UTC. */
  date: string;
  documents: number;
  positions: number;
}

export interface DashboardStats {
  period: DashboardPeriod;
  granularity: 'day' | 'month';
  documents: { total: number; byStatus: Partial<Record<DocumentStatus, number>> };
  positions: { total: number; successful: number; customsPaymentsRub: number };
  clients: { total: number; new: number; active: number };
  billing: {
    totalBalance: number;
    topUpPositions: number;
    chargedPositions: number;
    pendingTopUps: number;
  };
  /** Сотрудники (users) в скоупе. null для роли customs (ADMIN-метрика). */
  users: number | null;
  /** AI-токены за период. null для роли customs (ADMIN-метрика). */
  ai: { models: TokenUsageMap; leads: TokenUsageMap | null } | null;
  series: DashboardSeriesPoint[];
  recentDocuments: Array<
    Pick<Document, 'id' | 'originalFileName' | 'status' | 'createdAt'>
  >;
}

/**
 * Агрегаты для дашборда админки одним запросом фронта. Все метрики «за период»
 * скоупятся по created_at (полночь N-1 дня назад — как token-stats), метрики
 * текущего состояния (суммарный баланс, pending-заявки, всего клиентов) — нет.
 * companyId приходит уже разрешённым через resolveCompanyScope: undefined —
 * все компании (super_admin без фильтра).
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    private documentsService: DocumentsService,
  ) {}

  async getStats(opts: {
    period: DashboardPeriod;
    companyId?: string;
    includeAdminMetrics: boolean;
  }): Promise<DashboardStats> {
    const { period, companyId, includeAdminMetrics } = opts;
    const { days, granularity } = PERIOD_CONFIG[period];
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const [documents, positions, clients, billing, users, ai, series, recentDocuments] =
      await Promise.all([
        this.documentCounts(since, companyId),
        this.positionStats(since, companyId),
        this.clientStats(since, companyId),
        this.billingStats(since, companyId),
        includeAdminMetrics ? this.usersCount(companyId) : Promise.resolve(null),
        includeAdminMetrics
          ? this.documentsService.getAiTokensSummary(since, companyId)
          : Promise.resolve(null),
        this.series(since, granularity, companyId),
        this.recentDocuments(companyId),
      ]);

    return {
      period,
      granularity,
      documents,
      positions,
      clients,
      billing,
      users,
      ai,
      series,
      recentDocuments,
    };
  }

  private async documentCounts(since: Date, companyId?: string) {
    const byStatus: Partial<Record<DocumentStatus, number>> =
      await this.documentsService.getStatusCounts(companyId, since);
    const total = Object.values(byStatus).reduce((sum, count) => sum + (count ?? 0), 0);
    return { total, byStatus };
  }

  /**
   * Позиции документов, дошедших до расчёта за период: всего строк resultData,
   * из них успешно посчитанных (calculationStatus вне INCOMPLETE_CALCULATION_STATUSES —
   * по тому же правилу списывает депозит ClientBalanceService) и сумма начисленных
   * таможенных платежей (пошлина + НДС + акциз) в рублях. Один LATERAL-проход по
   * массиву позиций — все три агрегата из одного разворачивания JSONB.
   */
  private async positionStats(since: Date, companyId?: string) {
    // ::text — параметры приходят как text[], прямого оператора enum = text у Postgres нет.
    const params: unknown[] = [since, COMPLETED_STATUSES, INCOMPLETE_CALCULATION_STATUSES];
    let where = `doc.created_at >= $1 AND doc.status::text = ANY($2) AND doc.result_data IS NOT NULL`;
    if (companyId) {
      params.push(companyId);
      where += ` AND doc.company_id = $${params.length}`;
    }
    const [row]: Array<{ total: string; successful: string; paymentsRub: string | number }> =
      await this.repo.manager.query(
        `SELECT
           COUNT(*) AS "total",
           COUNT(*) FILTER (
             WHERE NOT (COALESCE(r.value->>'calculationStatus', 'ok') = ANY($3))
           ) AS "successful",
           COALESCE(SUM(
             COALESCE((r.value->>'dutyAmountRub')::numeric, 0)
             + COALESCE((r.value->>'vatAmountRub')::numeric, 0)
             + COALESCE((r.value->>'exciseAmountRub')::numeric, 0)
           ), 0)::float8 AS "paymentsRub"
         FROM documents doc
         CROSS JOIN LATERAL jsonb_array_elements(doc.result_data) r
         WHERE ${where}`,
        params,
      );
    return {
      total: Number(row?.total) || 0,
      successful: Number(row?.successful) || 0,
      customsPaymentsRub: Number(row?.paymentsRub) || 0,
    };
  }

  private async clientStats(since: Date, companyId?: string) {
    const totalsParams: unknown[] = [since];
    let totalsWhere = '';
    if (companyId) {
      totalsParams.push(companyId);
      totalsWhere = ` WHERE tu.company_id = $${totalsParams.length}`;
    }
    const activeParams: unknown[] = [since];
    let activeWhere = `doc.telegram_user_id IS NOT NULL AND doc.created_at >= $1`;
    if (companyId) {
      activeParams.push(companyId);
      activeWhere += ` AND doc.company_id = $${activeParams.length}`;
    }
    const [[totals], [active]] = await Promise.all([
      this.repo.manager.query(
        `SELECT COUNT(*) AS "total", COUNT(*) FILTER (WHERE tu.created_at >= $1) AS "new"
         FROM telegram_users tu${totalsWhere}`,
        totalsParams,
      ) as Promise<Array<{ total: string; new: string }>>,
      this.repo.manager.query(
        `SELECT COUNT(DISTINCT doc.telegram_user_id) AS "active"
         FROM documents doc WHERE ${activeWhere}`,
        activeParams,
      ) as Promise<Array<{ active: string }>>,
    ]);
    return {
      total: Number(totals?.total) || 0,
      new: Number(totals?.new) || 0,
      active: Number(active?.active) || 0,
    };
  }

  /**
   * Баланс — в «позициях» (кредиты клиентов). Тенант-скоуп через telegram_users
   * (billing_accounts.company_id при claim не обновляется — см. entity), EXISTS
   * вместо JOIN, чтобы будущая связь 1:N сотрудников не задваивала суммы.
   * Потоки за период: пополнения = topup (реальные деньги; grant — не выручка),
   * списания = charge минус возвраты пересчёта (adjustment с document_id);
   * ручные корректировки без документа в потоки не входят.
   */
  private async billingStats(since: Date, companyId?: string) {
    const tuExists = (accountRef: string, param: number) =>
      `EXISTS (SELECT 1 FROM telegram_users tu
        WHERE tu.billing_account_id = ${accountRef} AND tu.company_id = $${param})`;

    const balanceParams: unknown[] = [];
    let balanceWhere = '';
    if (companyId) {
      balanceParams.push(companyId);
      balanceWhere = ` WHERE ${tuExists('ba.id', balanceParams.length)}`;
    }

    const flowParams: unknown[] = [since];
    let flowWhere = `dt.created_at >= $1`;
    if (companyId) {
      flowParams.push(companyId);
      flowWhere += ` AND ${tuExists('dt.billing_account_id', flowParams.length)}`;
    }

    const pendingParams: unknown[] = [];
    let pendingWhere = `t.status = 'pending'`;
    if (companyId) {
      pendingParams.push(companyId);
      pendingWhere += ` AND ${tuExists('t.billing_account_id', pendingParams.length)}`;
    }

    const [[balance], [flows], [pending]] = await Promise.all([
      this.repo.manager.query(
        `SELECT COALESCE(SUM(ba.balance), 0) AS "totalBalance" FROM billing_accounts ba${balanceWhere}`,
        balanceParams,
      ) as Promise<Array<{ totalBalance: string }>>,
      this.repo.manager.query(
        `SELECT
           COALESCE(SUM(dt.delta) FILTER (WHERE dt.type = 'topup'), 0) AS "topUps",
           COALESCE(SUM(-dt.delta) FILTER (
             WHERE dt.type = 'charge' OR (dt.type = 'adjustment' AND dt.document_id IS NOT NULL)
           ), 0) AS "charged"
         FROM deposit_transactions dt WHERE ${flowWhere}`,
        flowParams,
      ) as Promise<Array<{ topUps: string; charged: string }>>,
      this.repo.manager.query(
        `SELECT COUNT(*) AS "pending" FROM top_up_requests t WHERE ${pendingWhere}`,
        pendingParams,
      ) as Promise<Array<{ pending: string }>>,
    ]);

    return {
      totalBalance: Number(balance?.totalBalance) || 0,
      topUpPositions: Number(flows?.topUps) || 0,
      chargedPositions: Number(flows?.charged) || 0,
      pendingTopUps: Number(pending?.pending) || 0,
    };
  }

  private async usersCount(companyId?: string): Promise<number> {
    const params: unknown[] = [];
    let where = '';
    if (companyId) {
      params.push(companyId);
      where = ` WHERE u.company_id = $${params.length}`;
    }
    const [row]: Array<{ count: string }> = await this.repo.manager.query(
      `SELECT COUNT(*) AS "count" FROM users u${where}`,
      params,
    );
    return Number(row?.count) || 0;
  }

  /** Документы и обработанные позиции по дням/месяцам (UTC, как token-stats/daily). */
  private async series(
    since: Date,
    granularity: 'day' | 'month',
    companyId?: string,
  ): Promise<DashboardSeriesPoint[]> {
    const dateFmt = granularity === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const params: unknown[] = [since, COMPLETED_STATUSES];
    let where = `doc.created_at >= $1`;
    if (companyId) {
      params.push(companyId);
      where += ` AND doc.company_id = $${params.length}`;
    }
    const rows: Array<{ date: string; documents: string; positions: string }> =
      await this.repo.manager.query(
        `SELECT to_char(doc.created_at AT TIME ZONE 'UTC', '${dateFmt}') AS "date",
           COUNT(*) AS "documents",
           COALESCE(SUM(jsonb_array_length(doc.result_data))
             FILTER (WHERE doc.status::text = ANY($2) AND doc.result_data IS NOT NULL), 0) AS "positions"
         FROM documents doc WHERE ${where}
         GROUP BY 1 ORDER BY 1`,
        params,
      );

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const result: DashboardSeriesPoint[] = [];
    const now = new Date();
    // Пропущенные точки заполняются нулями по UTC-датам — в соответствии с SQL.
    if (granularity === 'day') {
      const cursorMs = Date.UTC(since.getFullYear(), since.getMonth(), since.getDate());
      const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      for (let ms = cursorMs; ms <= todayMs; ms += 86_400_000) {
        result.push(this.seriesPoint(new Date(ms).toISOString().slice(0, 10), byDate));
      }
    } else {
      const cursor = new Date(Date.UTC(since.getFullYear(), since.getMonth(), 1));
      const end = Date.UTC(now.getFullYear(), now.getMonth(), 1);
      while (cursor.getTime() <= end) {
        result.push(this.seriesPoint(cursor.toISOString().slice(0, 7), byDate));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    return result;
  }

  private seriesPoint(
    date: string,
    byDate: Map<string, { documents: string; positions: string }>,
  ): DashboardSeriesPoint {
    const row = byDate.get(date);
    return {
      date,
      documents: Number(row?.documents) || 0,
      positions: Number(row?.positions) || 0,
    };
  }

  private recentDocuments(companyId?: string) {
    return this.repo.find({
      select: ['id', 'originalFileName', 'status', 'createdAt'],
      where: companyId ? { companyId } : {},
      order: { createdAt: 'DESC' },
      take: 6,
    });
  }
}
