import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IngestStatus, SourceType } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { IxcService } from '../integrations/ixc/ixc.service';
import type { IxcPlanDto } from '../integrations/ixc/ixc.types';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type KnowledgeIngestJob } from '../queues/queues.constants';
import { TenancyService } from '../tenancy/tenancy.service';

const SOURCE_ID = 'sales_ixc_catalog_candidate_v1';
const SOURCE_NAME = 'Catálogo comercial IXC — leitura factual';
const VALIDITY_MS = 26 * 60 * 60 * 1_000;
const MAX_PLANS = 250;

export interface IxcSalesCatalogRefreshResult {
  sourceId: string;
  planCount: number;
  observedAt: string;
  validUntil: string;
}

export interface IxcSalesCatalogRefreshBatchResult {
  organizations: number;
  refreshed: number;
  failed: number;
}

export interface IxcSalesCatalogStatus {
  state: 'MISSING' | 'PENDING' | 'READY' | 'FAILED' | 'EXPIRED';
  chunkCount: number;
  snapshotAt: string | null;
  validUntil: string | null;
}

/**
 * Atualiza o catálogo comercial exclusivamente a partir da leitura oficial
 * `vd_contratos` já limitada pelo adaptador IXC. Isso é sincronização factual,
 * não aprendizagem automática: não usa OPA, conversa de cliente nem texto
 * gerado pela IA, e a validade curta impede reutilizar uma tabela antiga.
 */
@Injectable()
export class IxcSalesCatalogRefreshService {
  constructor(
    private readonly ixc: IxcService,
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.KNOWLEDGE_INGEST)
    private readonly knowledgeIngestQueue: Queue<KnowledgeIngestJob>,
  ) {}

  async refresh(): Promise<IxcSalesCatalogRefreshResult> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const observedAt = new Date();
    const plans = this.normalizePlans(await this.ixc.listPlans());
    if (plans.length === 0) {
      // Uma resposta vazia não pode apagar conhecimento factual ainda válido.
      throw new ServiceUnavailableException('IXC não retornou planos ativos; catálogo atual não foi alterado');
    }

    const validUntil = new Date(observedAt.getTime() + VALIDITY_MS);
    const contentText = this.toKnowledgeText(plans, observedAt);
    const meta = {
      contentText,
      governance: 'APPROVED',
      authority: 100,
      department: 'sales',
      factualSource: 'IXC',
      origin: 'IXC_CATALOG_READONLY',
      contentClass: 'FACTUAL_CATALOG',
      snapshotAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      // Trata-se de atualização exata de uma fonte oficial, nunca de uma
      // publicação de candidato de aprendizagem.
      automaticPublication: false,
      automatedRefresh: true,
      sourceResource: 'vd_contratos',
    };

    const existing = await this.prisma.prismaSystem.knowledgeSource.findUnique({
      where: { id: SOURCE_ID },
      select: { orgId: true },
    });
    if (existing && existing.orgId !== orgId) {
      throw new ServiceUnavailableException('Identificador de catálogo pertence a outra organização');
    }

    await this.prisma.prismaSystem.knowledgeSource.upsert({
      where: { id: SOURCE_ID },
      create: {
        id: SOURCE_ID,
        orgId,
        type: SourceType.TEXT,
        name: SOURCE_NAME,
        status: IngestStatus.PENDING,
        meta,
      },
      update: {
        name: SOURCE_NAME,
        status: IngestStatus.PENDING,
        meta,
        chunkCount: 0,
      },
    });

    await this.knowledgeIngestQueue.add(
      'ingest',
      { orgId, sourceId: SOURCE_ID },
      { jobId: `ixc-sales-catalog-${observedAt.getTime()}` },
    );
    await this.audit.log({
      action: 'integration.ixc.catalog.sales.refresh',
      entity: 'KnowledgeSource',
      entityId: SOURCE_ID,
      meta: {
        sourceResource: 'vd_contratos',
        planCount: plans.length,
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
      },
    });

    return {
      sourceId: SOURCE_ID,
      planCount: plans.length,
      observedAt: observedAt.toISOString(),
      validUntil: validUntil.toISOString(),
    };
  }

  /** Executado pelo job periódico; cada organização falha de forma isolada. */
  async refreshAllEnabled(): Promise<IxcSalesCatalogRefreshBatchResult> {
    const integrations = await this.prisma.prismaSystem.ixcIntegration.findMany({
      where: { isEnabled: true },
      select: { orgId: true },
    });
    const orgIds = [...new Set(integrations.map((item) => item.orgId))];
    let refreshed = 0;
    let failed = 0;
    for (const orgId of orgIds) {
      try {
        await this.tenancy.run({ orgId }, () => this.refresh());
        refreshed += 1;
      } catch (error) {
        failed += 1;
        await this.audit.logSystem(orgId, {
          action: 'integration.ixc.catalog.sales.refresh.failed',
          entity: 'KnowledgeSource',
          entityId: SOURCE_ID,
          // Nunca persistir a resposta ou as credenciais de um provedor.
          meta: { reason: error instanceof Error ? error.name : 'unknown' },
        });
      }
    }
    return { organizations: orgIds.length, refreshed, failed };
  }

  async status(): Promise<IxcSalesCatalogStatus> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const source = await this.prisma.prismaSystem.knowledgeSource.findFirst({
      where: { id: SOURCE_ID, orgId },
      select: { status: true, chunkCount: true, meta: true },
    });
    if (!source) return { state: 'MISSING', chunkCount: 0, snapshotAt: null, validUntil: null };
    const meta = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta)
      ? source.meta as Record<string, unknown>
      : {};
    const snapshotAt = typeof meta.snapshotAt === 'string' ? meta.snapshotAt : null;
    const validUntil = typeof meta.validUntil === 'string' ? meta.validUntil : null;
    const validAt = validUntil ? Date.parse(validUntil) : Number.NaN;
    const state: IxcSalesCatalogStatus['state'] = source.status === IngestStatus.READY
      ? (Number.isFinite(validAt) && validAt > Date.now() ? 'READY' : 'EXPIRED')
      : source.status === IngestStatus.FAILED ? 'FAILED' : 'PENDING';
    return { state, chunkCount: source.chunkCount, snapshotAt, validUntil };
  }

  private normalizePlans(plans: IxcPlanDto[]): IxcPlanDto[] {
    const unique = new Map<string, IxcPlanDto>();
    for (const plan of plans) {
      const name = this.cleanText(plan.name, 180);
      if (!plan.id || !name || plan.active === false || unique.has(plan.id)) continue;
      unique.set(plan.id, {
        ...plan,
        name,
        value: typeof plan.value === 'number' && Number.isFinite(plan.value) && plan.value >= 0
          ? plan.value
          : null,
        loyaltyMonths: Number.isInteger(plan.loyaltyMonths) && (plan.loyaltyMonths ?? 0) >= 0
          ? plan.loyaltyMonths
          : null,
      });
    }
    return [...unique.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      .slice(0, MAX_PLANS);
  }

  private toKnowledgeText(plans: IxcPlanDto[], observedAt: Date): string {
    const rows = plans.map((plan) => {
      const value = plan.value === null ? 'valor não informado no IXC' : this.formatCurrency(plan.value);
      const loyalty = plan.loyaltyMonths === null
        ? 'fidelidade não informada no IXC'
        : plan.loyaltyMonths === 0
          ? 'sem fidelidade informada'
          : `${plan.loyaltyMonths} meses de fidelidade`;
      return `- ${plan.name}: mensalidade ${value}; ${loyalty}.`;
    });
    return [
      '# Catálogo comercial IXC — leitura factual',
      `Atualizado em ${observedAt.toISOString()} a partir do recurso IXC vd_contratos, filtrado para registros ativos.`,
      'Use estes dados apenas como catálogo geral. Cobertura no endereço, elegibilidade, descontos, promoção e proposta individual exigem verificação própria; não devem ser inferidos desta fonte.',
      '',
      '## Planos ativos',
      ...rows,
    ].join('\n');
  }

  private cleanText(value: string, maxLength: number): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
}
