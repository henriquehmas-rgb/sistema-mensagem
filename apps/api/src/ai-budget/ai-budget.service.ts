import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { Env } from '../config/env.validation';

export type AiBudgetLevel = 'NORMAL' | 'WATCH' | 'ELEVATED' | 'CRITICAL';

interface AggregateRow { estimated_brl: Prisma.Decimal | number | string; }
interface AlertRow {
  id: string; threshold: number; estimated_brl: Prisma.Decimal | number | string;
  budget_brl: Prisma.Decimal | number | string; recipient_email: string;
  acknowledged_at: Date | null; created_at: Date;
}

@Injectable()
export class AiBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async status() {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const [aggregate, alerts] = await Promise.all([
      this.prisma.prismaSystem.$queryRaw<AggregateRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(estimated_brl), 0) AS estimated_brl
        FROM ai_usage_events
        WHERE org_id = ${orgId}
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      `),
      this.prisma.prismaSystem.$queryRaw<AlertRow[]>(Prisma.sql`
        SELECT id, threshold, estimated_brl, budget_brl, recipient_email,
               acknowledged_at, created_at
        FROM ai_budget_alerts
        WHERE org_id = ${orgId}
          AND month_start = date_trunc('month', CURRENT_DATE)::date
        ORDER BY threshold DESC
      `),
    ]);
    const estimatedBrl = Number(aggregate[0]?.estimated_brl ?? 0);
    const budgetBrl = Number(
      alerts[0]?.budget_brl
      ?? this.config.get('AI_MONTHLY_ATTENTION_BUDGET_BRL', { infer: true }),
    );
    const percentage = budgetBrl > 0 ? estimatedBrl / budgetBrl * 100 : 0;
    const reachedThreshold = percentage >= 100 ? 100 : percentage >= 90 ? 90 : percentage >= 75 ? 75 : percentage >= 50 ? 50 : null;
    const level: AiBudgetLevel = percentage >= 100 ? 'CRITICAL' : percentage >= 90 ? 'ELEVATED' : percentage >= 75 ? 'WATCH' : 'NORMAL';
    const nextThreshold = [50, 75, 90, 100].find((value) => percentage < value) ?? null;
    return {
      month: new Date().toISOString().slice(0, 7), budgetBrl, estimatedBrl,
      percentage: Math.round(percentage * 100) / 100, reachedThreshold,
      nextThreshold, level, blocksService: false,
      estimationNotice: 'Estimativa operacional; a fatura dos provedores é a referência financeira final.',
      alerts: alerts.map((alert) => ({
        id: alert.id, threshold: alert.threshold,
        estimatedBrl: Number(alert.estimated_brl), budgetBrl: Number(alert.budget_brl),
        recipientEmail: alert.recipient_email,
        acknowledgedAt: alert.acknowledged_at?.toISOString() ?? null,
        createdAt: alert.created_at.toISOString(),
      })),
    };
  }

  async acknowledge(id: string) {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE ai_budget_alerts SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING id
    `);
    if (!rows[0]) throw new NotFoundException('Alerta de orçamento não encontrado');
    await this.audit.log({ action: 'ai_budget_alert.acknowledge', entity: 'AiBudgetAlert', entityId: id });
    return this.status();
  }
}
