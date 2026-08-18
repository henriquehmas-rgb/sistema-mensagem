import { Injectable } from '@nestjs/common';
import { ConversationStatus, Prisma, type ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

export interface DashboardMetricsDto {
  openConversations: number;
  unassignedConversations: number;
  byStage: Array<{ stageId: string; name: string; color: string; count: number }>;
  byChannel: Array<{ channelType: ChannelType; count: number }>;
  byAgent: Array<{ agentId: string; name: string; count: number }>;
  messagesToday: number;
  /** Média (min) entre a 1ª msg INBOUND e a 1ª resposta OUTBOUND — últimos 7 dias. */
  avgFirstResponseMinutes: number | null;
}

/** GET /dashboard/metrics (CONTRACTS §6). Contadores operam sobre conversas abertas. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  async metrics(): Promise<DashboardMetricsDto> {
    const [
      openConversations,
      unassignedConversations,
      byStage,
      byChannel,
      byAgent,
      messagesToday,
      avgFirstResponseMinutes,
    ] = await Promise.all([
      this.prisma.tenant.conversation.count({ where: { status: ConversationStatus.OPEN } }),
      this.prisma.tenant.conversation.count({
        where: { status: ConversationStatus.OPEN, assigneeId: null },
      }),
      this.countByStage(),
      this.countByChannel(),
      this.countByAgent(),
      this.countMessagesToday(),
      this.avgFirstResponseMinutes(),
    ]);

    return {
      openConversations,
      unassignedConversations,
      byStage,
      byChannel,
      byAgent,
      messagesToday,
      avgFirstResponseMinutes,
    };
  }

  private async countByStage(): Promise<DashboardMetricsDto['byStage']> {
    const [groups, stages] = await Promise.all([
      this.prisma.tenant.conversation.groupBy({
        by: ['stageId'],
        where: { status: ConversationStatus.OPEN, stageId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.tenant.pipelineStage.findMany({ orderBy: { position: 'asc' } }),
    ]);
    const counts = new Map(groups.map((group) => [group.stageId, group._count._all]));
    return stages.map((stage) => ({
      stageId: stage.id,
      name: stage.name,
      color: stage.color,
      count: counts.get(stage.id) ?? 0,
    }));
  }

  private async countByChannel(): Promise<DashboardMetricsDto['byChannel']> {
    const [groups, channels] = await Promise.all([
      this.prisma.tenant.conversation.groupBy({
        by: ['channelId'],
        where: { status: ConversationStatus.OPEN },
        _count: { _all: true },
      }),
      this.prisma.tenant.channel.findMany({ select: { id: true, type: true } }),
    ]);
    const typeById = new Map(channels.map((channel) => [channel.id, channel.type]));
    const totals = new Map<ChannelType, number>();
    for (const group of groups) {
      const type = typeById.get(group.channelId);
      if (type) {
        totals.set(type, (totals.get(type) ?? 0) + group._count._all);
      }
    }
    return [...totals.entries()].map(([channelType, count]) => ({ channelType, count }));
  }

  private async countByAgent(): Promise<DashboardMetricsDto['byAgent']> {
    const groups = await this.prisma.tenant.conversation.groupBy({
      by: ['assigneeId'],
      where: { status: ConversationStatus.OPEN, assigneeId: { not: null } },
      _count: { _all: true },
    });
    const agentIds = groups
      .map((group) => group.assigneeId)
      .filter((id): id is string => id !== null);
    if (agentIds.length === 0) {
      return [];
    }
    const users = await this.prisma.tenant.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    return groups
      .filter((group): group is typeof group & { assigneeId: string } => group.assigneeId !== null)
      .map((group) => ({
        agentId: group.assigneeId,
        name: nameById.get(group.assigneeId) ?? 'desconhecido',
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  }

  private async countMessagesToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.tenant.message.count({ where: { createdAt: { gte: startOfDay } } });
  }

  /**
   * Tempo médio de primeira resposta (últimos 7 dias) via SQL: para cada conversa
   * com INBOUND no período, mede até a primeira OUTBOUND (humana ou IA, exceto
   * SYSTEM) posterior. Raw query → filtro de org_id MANUAL e obrigatório.
   */
  private async avgFirstResponseMinutes(): Promise<number | null> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{ avg_seconds: number | null }>>(
      Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM (fr.first_response - fi.first_inbound)))::float8 AS avg_seconds
        FROM (
          SELECT conversation_id, MIN(created_at) AS first_inbound
          FROM messages
          WHERE org_id = ${orgId}
            AND direction = 'INBOUND'
            AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY conversation_id
        ) fi
        JOIN LATERAL (
          SELECT MIN(m.created_at) AS first_response
          FROM messages m
          WHERE m.org_id = ${orgId}
            AND m.conversation_id = fi.conversation_id
            AND m.direction = 'OUTBOUND'
            AND m.type <> 'SYSTEM'
            AND m.created_at > fi.first_inbound
        ) fr ON fr.first_response IS NOT NULL
      `,
    );
    const avgSeconds = rows[0]?.avg_seconds ?? null;
    return avgSeconds === null ? null : Math.round((avgSeconds / 60) * 10) / 10;
  }
}
