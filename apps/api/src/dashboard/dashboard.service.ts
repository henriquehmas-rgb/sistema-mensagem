import { Injectable } from '@nestjs/common';
import {
  ConversationStatus,
  KnowledgeGapStatus,
  LearningCandidateStatus,
  OperationalActionRequestStatus,
  Prisma,
  TemplateStatus,
  type ChannelType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { CreateReadinessSnapshotDto } from './dto/create-readiness-snapshot.dto';
import {
  assessOperationalReadiness,
  type OperationalReadinessResult,
  type OperationalSectorKey,
} from './operational-readiness.policy';
import {
  assessIntegrationActivationReadiness,
  type IntegrationActivationReadinessResult,
} from './integration-activation-readiness.policy';

export interface DashboardMetricsDto {
  openConversations: number;
  unassignedConversations: number;
  byStage: Array<{ stageId: string; name: string; color: string; count: number }>;
  byChannel: Array<{ channelType: ChannelType; count: number }>;
  byAgent: Array<{ agentId: string; name: string; count: number }>;
  messagesToday: number;
  /** Média (segundos) entre a 1ª msg INBOUND e a 1ª resposta OUTBOUND — últimos 7 dias. */
  avgFirstResponseSeconds: number | null;
  /** Piloto de Suporte: somente contadores agregados dos últimos 30 dias. */
  supportPilot: SupportPilotMetricsDto;
  /** Parecer de liberação em leitura para os três setores operacionais. */
  operationalReadiness: OperationalReadinessResult[];
  /** Checklist objetivo antes de qualquer ativação de canal externo. */
  integrationActivationReadiness: IntegrationActivationReadinessResult;
}

export interface SupportPilotMetricsDto {
  periodDays: number;
  conversations: number;
  externalChannelConversations: number;
  resolved: number;
  resolvedWithoutGap: number;
  active: number;
  triageConflicts: number;
  lowConfidenceTriages: number;
  lowConfidenceWithoutAlternative: number;
  /** União das duas condições de triagem, por conversa. */
  triageAttentionConversations: number;
  conversationsWithRepeatedClarification: number;
  pendingKnowledgeGaps: number;
  answeredKnowledgeGaps: number;
  dismissedKnowledgeGaps: number;
  /** Falhas de IXC, identidade ou provedor; nunca entram na aprendizagem. */
  technicalIncidents: number;
  /** Baixa confiança e casos operacionais que precisam de revisão, não de RAG. */
  operationalReviews: number;
  pendingShadowProposals: number;
  shadowProposalsCreated: number;
  pendingLearningCandidates: number;
  autoPublishedLanguageCandidates: number;
  aiRepliesWithTrace: number;
  aiRepliesWithoutTrace: number;
  unclassifiedAiReplies: number;
  networkBoxEvaluations: number;
  networkBoxCohortsObserved: number;
  networkBoxWithIndependentNetworkEvent: number;
  networkBoxInsufficientEvidence: number;
  avgFirstResponseSeconds: number | null;
}

/** A mesma régua sempre exposta separada das configurações externas. */
export interface ReadinessOverviewDto {
  generatedAt: string;
  operational: OperationalReadinessResult[];
  integration: IntegrationActivationReadinessResult;
}

/** GET /dashboard/metrics (CONTRACTS §6). Contadores operam sobre conversas abertas. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async readiness(): Promise<ReadinessOverviewDto> {
    const metrics = await this.metrics();
    return {
      generatedAt: new Date().toISOString(),
      operational: metrics.operationalReadiness,
      integration: metrics.integrationActivationReadiness,
    };
  }

  /**
   * Congela a leitura agregada para comparação histórica. Esta operação não
   * habilita canal, não altera modo e não contém conversa, cliente ou segredo.
   */
  async createReadinessSnapshot(actor: AuthUser, dto: CreateReadinessSnapshotDto) {
    const overview = await this.readiness();
    const snapshot = await this.prisma.tenant.readinessSnapshot.create({
      data: {
        orgId: actor.orgId,
        createdById: actor.userId,
        label: dto.label?.trim() || null,
        operational: overview.operational as unknown as Prisma.InputJsonValue,
        integration: overview.integration as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, label: true, operational: true, integration: true, createdAt: true },
    });
    await this.audit.log({
      action: 'dashboard.readiness-snapshot.create',
      entity: 'ReadinessSnapshot',
      entityId: snapshot.id,
      meta: { label: snapshot.label },
    });
    return snapshot;
  }

  async listReadinessSnapshots() {
    return this.prisma.tenant.readinessSnapshot.findMany({
      select: { id: true, label: true, operational: true, integration: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async metrics(): Promise<DashboardMetricsDto> {
    const [
      openConversations,
      unassignedConversations,
      byStage,
      byChannel,
      byAgent,
      messagesToday,
      avgFirstResponseSeconds,
      supportPilot,
    ] = await Promise.all([
      this.prisma.tenant.conversation.count({ where: { status: ConversationStatus.OPEN } }),
      this.prisma.tenant.conversation.count({
        where: { status: ConversationStatus.OPEN, assigneeId: null },
      }),
      this.countByStage(),
      this.countByChannel(),
      this.countByAgent(),
      this.countMessagesToday(),
      this.avgFirstResponseSeconds(),
      this.supportPilot(),
    ]);

    const [operationalReadiness, integrationActivationReadiness] = await Promise.all([
      this.operationalReadiness(supportPilot),
      this.integrationActivationReadiness(),
    ]);
    return {
      openConversations,
      unassignedConversations,
      byStage,
      byChannel,
      byAgent,
      messagesToday,
      avgFirstResponseSeconds,
      supportPilot,
      operationalReadiness,
      integrationActivationReadiness,
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
  private async avgFirstResponseSeconds(): Promise<number | null> {
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
    return avgSeconds === null ? null : Math.round(avgSeconds);
  }

  /**
   * Indicadores do piloto de Suporte. A consulta parte da chave oficial do setor,
   * nunca de texto de mensagem, e retorna apenas totais para não expor dados pessoais.
   */
  private async supportPilot(): Promise<SupportPilotMetricsDto> {
    return this.sectorPilot('technical_support');
  }

  /**
   * Mesma leitura agregada para todos os setores. Mantemos `supportPilot`
   * por compatibilidade com o painel existente e usamos esta base na decisão
   * de prontidão multissetor.
   */
  private async sectorPilot(routingKey: OperationalSectorKey): Promise<SupportPilotMetricsDto> {
    const periodDays = 30;
    const since = new Date();
    since.setDate(since.getDate() - periodDays);
    const department = await this.prisma.tenant.department.findFirst({
      where: { routingKey, isActive: true },
      select: { id: true },
    });
    if (!department) {
      return {
        periodDays,
        conversations: 0,
        externalChannelConversations: 0,
        resolved: 0,
        resolvedWithoutGap: 0,
        active: 0,
        triageConflicts: 0,
        lowConfidenceTriages: 0,
        lowConfidenceWithoutAlternative: 0,
        triageAttentionConversations: 0,
        conversationsWithRepeatedClarification: 0,
        pendingKnowledgeGaps: 0,
        answeredKnowledgeGaps: 0,
        dismissedKnowledgeGaps: 0,
        technicalIncidents: 0,
        operationalReviews: 0,
        pendingShadowProposals: 0,
        shadowProposalsCreated: 0,
        pendingLearningCandidates: 0,
        autoPublishedLanguageCandidates: 0,
        aiRepliesWithTrace: 0,
        aiRepliesWithoutTrace: 0,
        unclassifiedAiReplies: 0,
        networkBoxEvaluations: 0,
        networkBoxCohortsObserved: 0,
        networkBoxWithIndependentNetworkEvent: 0,
        networkBoxInsufficientEvidence: 0,
        avgFirstResponseSeconds: null,
      };
    }

    const departmentId = department.id;
    const createdInPeriod = { departmentId, createdAt: { gte: since } };
    const [
      conversations,
      externalChannelConversations,
      resolved,
      resolvedWithoutGap,
      active,
      triageConflicts,
      lowConfidenceTriages,
      lowConfidenceWithoutAlternative,
      triageAttentionConversations,
      conversationsWithRepeatedClarification,
      pendingKnowledgeGaps,
      answeredKnowledgeGaps,
      dismissedKnowledgeGaps,
      handoffDispositions,
      pendingShadowProposals,
      shadowProposalsCreated,
      pendingLearningCandidates,
      autoPublishedLanguageCandidates,
      traceCoverage,
      networkBoxEvidence,
      avgFirstResponseSeconds,
    ] = await Promise.all([
      this.prisma.tenant.conversation.count({ where: createdInPeriod }),
      this.prisma.tenant.conversation.count({
        where: {
          ...createdInPeriod,
          channel: { type: { in: ['WHATSAPP', 'INSTAGRAM'] } },
        },
      }),
      this.prisma.tenant.conversation.count({
        where: { departmentId, status: ConversationStatus.RESOLVED, resolvedAt: { gte: since } },
      }),
      this.prisma.tenant.conversation.count({
        where: {
          departmentId,
          status: ConversationStatus.RESOLVED,
          resolvedAt: { gte: since },
          // Incidentes e revisões podem estar anexados à conversa, mas não
          // representam ausência factual do RAG. Esta métrica mede somente
          // lacunas reais de conhecimento aprovável.
          knowledgeGaps: {
            none: {
              reason: { in: ['sem_contexto_na_base_de_conhecimento', 'contexto_insuficiente'] },
            },
          },
        },
      }),
      this.prisma.tenant.conversation.count({
        where: { departmentId, status: { in: [ConversationStatus.OPEN, ConversationStatus.PENDING] } },
      }),
      this.prisma.tenant.conversation.count({
        where: { ...createdInPeriod, triageConflict: true },
      }),
      this.prisma.tenant.conversation.count({
        where: { ...createdInPeriod, triageConfidence: { lt: 0.8 } },
      }),
      this.prisma.tenant.conversation.count({
        where: {
          ...createdInPeriod,
          triageConflict: false,
          triageConfidence: { lt: 0.8 },
          secondaryIntent: null,
          alternativeRouteKey: null,
        },
      }),
      this.prisma.tenant.conversation.count({
        where: {
          ...createdInPeriod,
          OR: [
            { triageConflict: true },
            {
              triageConfidence: { lt: 0.8 },
              OR: [
                { secondaryIntent: { not: null } },
                { alternativeRouteKey: { not: null } },
              ],
            },
          ],
        },
      }),
      this.confirmedRepeatedClarifications(departmentId, since),
      this.prisma.tenant.knowledgeGap.count({
        where: { departmentId, status: KnowledgeGapStatus.PENDING },
      }),
      this.prisma.tenant.knowledgeGap.count({
        where: {
          departmentId,
          status: { in: [KnowledgeGapStatus.ANSWERED, KnowledgeGapStatus.APPLIED] },
          answeredAt: { gte: since },
        },
      }),
      this.prisma.tenant.knowledgeGap.count({
        where: {
          departmentId,
          status: KnowledgeGapStatus.DISMISSED,
          updatedAt: { gte: since },
        },
      }),
      this.handoffDispositionCounts(departmentId, since),
      this.prisma.tenant.operationalActionRequest.count({
        where: {
          status: OperationalActionRequestStatus.PENDING_REVIEW,
          conversation: { departmentId },
        },
      }),
      this.prisma.tenant.operationalActionRequest.count({
        where: {
          createdAt: { gte: since },
          conversation: { departmentId },
        },
      }),
      this.prisma.tenant.learningCandidate.count({
        where: {
          status: LearningCandidateStatus.PENDING,
          conversation: { departmentId },
        },
      }),
      this.prisma.tenant.learningCandidate.count({
        where: {
          autoPublishedAt: { gte: since },
          conversation: { departmentId },
        },
      }),
      this.supportAiTraceCoverage(departmentId, since),
      this.supportNetworkBoxEvidence(departmentId, since),
      this.avgSupportFirstResponseSeconds(departmentId, since),
    ]);
    return {
      periodDays,
      conversations,
      externalChannelConversations,
      resolved,
      resolvedWithoutGap,
      active,
      triageConflicts,
      lowConfidenceTriages,
      lowConfidenceWithoutAlternative,
      triageAttentionConversations,
      conversationsWithRepeatedClarification,
      pendingKnowledgeGaps,
      answeredKnowledgeGaps,
      dismissedKnowledgeGaps,
      technicalIncidents: handoffDispositions.technicalIncidents,
      operationalReviews: handoffDispositions.operationalReviews,
      pendingShadowProposals,
      shadowProposalsCreated,
      pendingLearningCandidates,
      autoPublishedLanguageCandidates,
      aiRepliesWithTrace: traceCoverage.withTrace,
      aiRepliesWithoutTrace: traceCoverage.withoutTrace,
      unclassifiedAiReplies: traceCoverage.unclassified,
      networkBoxEvaluations: networkBoxEvidence.evaluations,
      networkBoxCohortsObserved: networkBoxEvidence.cohortsObserved,
      networkBoxWithIndependentNetworkEvent: networkBoxEvidence.withIndependentNetworkEvent,
      networkBoxInsufficientEvidence: networkBoxEvidence.insufficientEvidence,
      avgFirstResponseSeconds,
    };
  }

  private async operationalReadiness(
    supportPilot: SupportPilotMetricsDto,
  ): Promise<OperationalReadinessResult[]> {
    const [billingPilot, salesPilot] = await Promise.all([
      this.sectorPilot('billing'),
      this.sectorPilot('sales'),
    ]);
    const sectors: Array<{ sector: OperationalSectorKey; pilot: SupportPilotMetricsDto }> = [
      { sector: 'technical_support', pilot: supportPilot },
      { sector: 'billing', pilot: billingPilot },
      { sector: 'sales', pilot: salesPilot },
    ];
    return sectors.map(({ sector, pilot }) => assessOperationalReadiness({
      sector,
      conversations: pilot.conversations,
      externalChannelConversations: pilot.externalChannelConversations,
      triageConflicts: pilot.triageConflicts,
      lowConfidenceTriages: pilot.lowConfidenceTriages,
      lowConfidenceWithoutAlternative: pilot.lowConfidenceWithoutAlternative,
      triageAttentionConversations: pilot.triageAttentionConversations,
      conversationsWithRepeatedClarification: pilot.conversationsWithRepeatedClarification,
      pendingKnowledgeGaps: pilot.pendingKnowledgeGaps,
      pendingShadowProposals: pilot.pendingShadowProposals,
      aiRepliesWithTrace: pilot.aiRepliesWithTrace,
      aiRepliesWithoutTrace: pilot.aiRepliesWithoutTrace,
      unclassifiedAiReplies: pilot.unclassifiedAiReplies,
      technicalIncidents: pilot.technicalIncidents,
      operationalReviews: pilot.operationalReviews,
    }));
  }

  /**
   * Evidencia pendências de ativação sem retornar credenciais, identificadores
   * nem qualquer dado de cliente. O último teste é obtido do log de auditoria,
   * pois Channel.status sozinho pode ser definido manualmente.
   */
  private async integrationActivationReadiness(): Promise<IntegrationActivationReadinessResult> {
    const [channels, mappings] = await Promise.all([
      this.prisma.tenant.channel.findMany({
        where: { type: { in: ['WHATSAPP', 'INSTAGRAM'] } },
        select: {
          id: true,
          type: true,
          externalId: true,
          encryptedCredentials: true,
          templates: { where: { status: TemplateStatus.APPROVED }, select: { id: true } },
        },
      }),
      this.prisma.tenant.networkTopologyMapping.findMany({
        select: { status: true },
      }),
    ]);
    const auditRows = channels.length === 0
      ? []
      : await this.prisma.tenant.auditLog.findMany({
        where: { action: 'channel.test', entity: 'Channel', entityId: { in: channels.map((channel) => channel.id) } },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, meta: true },
      });
    const lastTestByChannel = new Map<string, boolean>();
    for (const row of auditRows) {
      if (lastTestByChannel.has(row.entityId)) continue;
      const meta = row.meta as Record<string, unknown>;
      if (typeof meta.success === 'boolean') lastTestByChannel.set(row.entityId, meta.success);
    }
    const byType = new Map(channels.map((channel) => [channel.type, channel]));
    const readinessChannels = (['WHATSAPP', 'INSTAGRAM'] as const).map((type) => {
      const channel = byType.get(type);
      return {
        channel: type,
        configured: Boolean(channel),
        hasCredentials: Boolean(channel?.encryptedCredentials),
        hasExternalId: Boolean(channel?.externalId),
        lastTestSucceeded: channel ? (lastTestByChannel.get(channel.id) ?? null) : null,
        approvedTemplates: channel?.templates.length ?? 0,
      };
    });
    return assessIntegrationActivationReadiness({
      channels: readinessChannels,
      sentryConfigured: Boolean(this.config.get('SENTRY_DSN', { infer: true })),
      teamsAlertsConfigured: Boolean(
        this.config.get('OPERATIONS_TEAMS_ALERTS_ENABLED', { infer: true })
        && this.config.get('OPERATIONS_TEAMS_WEBHOOK_URL', { infer: true }),
      ),
      confirmedTopologyMappings: mappings.filter((mapping) => mapping.status === 'CONFIRMED').length,
      shadowTopologyMappings: mappings.filter((mapping) => mapping.status === 'SHADOW').length,
    });
  }

  /**
   * O handoff é classificado antes de qualquer GAP ser criado. Lemos apenas
   * contadores de auditoria para manter incidente e revisão operacional fora
   * das métricas de aprendizagem. O vínculo é feito pela conversa para não
   * misturar incidentes de outro setor no painel atual.
   */
  private async handoffDispositionCounts(departmentId: string, since: Date): Promise<{
    technicalIncidents: number;
    operationalReviews: number;
  }> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{
      technical_incidents: number | null;
      operational_reviews: number | null;
    }>>(
      Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE meta->>'disposition' = 'TECHNICAL_INCIDENT'
          )::int AS technical_incidents,
          COUNT(*) FILTER (
            WHERE meta->>'disposition' = 'OPERATIONAL_REVIEW'
          )::int AS operational_reviews
        FROM audit_logs a
        JOIN conversations c ON c.id = a.entity_id
        WHERE a.org_id = ${orgId}
          AND c.org_id = ${orgId}
          AND c.department_id = ${departmentId}
          AND a.created_at >= ${since}
          AND a.action = 'ai.handoff.classified'
      `,
    );
    return {
      technicalIncidents: rows[0]?.technical_incidents ?? 0,
      operationalReviews: rows[0]?.operational_reviews ?? 0,
    };
  }

  /**
   * A resposta persiste a expectativa de rastro. Dessa forma, só entram no
   * denominador de cobertura as mensagens que de fato exigem evidência; saudações,
   * encerramentos e perguntas de diagnóstico não distorcem a métrica factual.
   */
  private async supportAiTraceCoverage(
    departmentId: string,
    since: Date,
  ): Promise<{ withTrace: number; withoutTrace: number; unclassified: number }> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{
      with_trace: number | null;
      without_trace: number | null;
      unclassified: number | null;
    }>>(
      Prisma.sql`
        SELECT
          COUNT(*) FILTER (
            WHERE m.content->'trace'->>'expectation' = 'REQUIRED'
              AND jsonb_array_length(COALESCE(m.content->'sources', '[]'::jsonb)) > 0
          )::int AS with_trace,
          COUNT(*) FILTER (
            WHERE m.content->'trace'->>'expectation' = 'REQUIRED'
              AND jsonb_array_length(COALESCE(m.content->'sources', '[]'::jsonb)) = 0
          )::int AS without_trace
          ,COUNT(*) FILTER (
            WHERE m.content->'trace'->>'expectation' = 'UNCLASSIFIED'
              OR m.content->'trace' IS NULL
          )::int AS unclassified
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.org_id = ${orgId}
          AND c.org_id = ${orgId}
          AND c.department_id = ${departmentId}
          AND m.created_at >= ${since}
          AND m.direction = 'OUTBOUND'
          AND m.is_ai_generated = true
      `,
    );
    return {
      withTrace: rows[0]?.with_trace ?? 0,
      withoutTrace: rows[0]?.without_trace ?? 0,
      unclassified: rows[0]?.unclassified ?? 0,
    };
  }

  /**
   * Conta apenas a repetição da mesma etapa persistida a partir da política de
   * observação. O antigo contador acumulado de esclarecimentos não é usado,
   * pois uma conversa completa pode pedir duas informações diferentes sem
   * qualquer regressão de contexto.
   */
  private async confirmedRepeatedClarifications(departmentId: string, since: Date): Promise<number> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{ total: number | null }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT m.conversation_id
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.org_id = ${orgId}
            AND c.org_id = ${orgId}
            AND c.department_id = ${departmentId}
            AND m.created_at >= ${since}
            AND m.direction = 'OUTBOUND'
            AND m.is_ai_generated = true
            AND m.content->>'clarificationKey' IS NOT NULL
            AND m.content->>'clarificationKey' <> 'UNSPECIFIED'
          GROUP BY m.conversation_id, m.content->>'clarificationKey'
          HAVING COUNT(*) >= 2
        ) repeated
      `,
    );
    return rows[0]?.total ?? 0;
  }

  /**
   * Leitura agregada da auditoria de correlação IXC -> caixa -> ODG. O mapa
   * técnico e os clientes nunca saem da integração; o painel mede apenas se a
   * evidência existe e como ela foi classificada em modo sombra.
   */
  private async supportNetworkBoxEvidence(
    departmentId: string,
    since: Date,
  ): Promise<{
    evaluations: number;
    cohortsObserved: number;
    withIndependentNetworkEvent: number;
    insufficientEvidence: number;
  }> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{
      evaluations: number | null;
      cohorts_observed: number | null;
      with_independent_network_event: number | null;
      insufficient_evidence: number | null;
    }>>(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS evaluations,
          COUNT(*) FILTER (WHERE a.meta->>'assessment' = 'BOX_COHORT_OBSERVED')::int AS cohorts_observed,
          COUNT(*) FILTER (WHERE a.meta->>'assessment' = 'BOX_COHORT_WITH_INDEPENDENT_NETWORK_EVENT')::int AS with_independent_network_event,
          COUNT(*) FILTER (WHERE a.meta->>'assessment' = 'INSUFFICIENT_EVIDENCE')::int AS insufficient_evidence
        FROM audit_logs a
        JOIN conversations c ON c.id = a.entity_id
        WHERE a.org_id = ${orgId}
          AND c.org_id = ${orgId}
          AND c.department_id = ${departmentId}
          AND a.action = 'ai.network-box-evidence.evaluate'
          AND a.created_at >= ${since}
      `,
    );
    return {
      evaluations: rows[0]?.evaluations ?? 0,
      cohortsObserved: rows[0]?.cohorts_observed ?? 0,
      withIndependentNetworkEvent: rows[0]?.with_independent_network_event ?? 0,
      insufficientEvidence: rows[0]?.insufficient_evidence ?? 0,
    };
  }

  /** Média de primeira resposta limitada ao setor e à janela do piloto. */
  private async avgSupportFirstResponseSeconds(departmentId: string, since: Date): Promise<number | null> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const rows = await this.prisma.prismaSystem.$queryRaw<Array<{ avg_seconds: number | null }>>(
      Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM (fr.first_response - fi.first_inbound)))::float8 AS avg_seconds
        FROM (
          SELECT m.conversation_id, MIN(m.created_at) AS first_inbound
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE m.org_id = ${orgId}
            AND c.org_id = ${orgId}
            AND c.department_id = ${departmentId}
            AND c.created_at >= ${since}
            AND m.direction = 'INBOUND'
          GROUP BY m.conversation_id
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
    return avgSeconds === null ? null : Math.round(avgSeconds);
  }
}
