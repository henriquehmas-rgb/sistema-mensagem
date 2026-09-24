import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LearningCandidateStatus,
  SourceType,
  IngestStatus,
  type KnowledgeSource,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type KnowledgeIngestJob } from '../queues/queues.constants';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateKnowledgeSourceDto } from './dto/create-knowledge-source.dto';
import { assertKnowledgeContentIsSafe } from './knowledge-content-safety';

export interface KnowledgeSourceDto {
  id: string;
  type: SourceType;
  name: string;
  status: IngestStatus;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  authority: number;
  validUntil: string | null;
}

export interface LearningCandidateDto {
  id: string;
  conversationId: string;
  intent: string | null;
  content: string;
  status: LearningCandidateStatus;
  qualityScore: number;
  recurrenceCount: number;
  autoPublishEligible: boolean;
  autoPublishedAt: string | null;
  createdAt: string;
}

export interface LearningPatternDto {
  fingerprint: string;
  intent: string | null;
  sample: string;
  occurrences7d: number;
  occurrences30d: number;
  occurrences90d: number;
  previous30d: number;
  growthPercent: number | null;
  averageQuality: number;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.KNOWLEDGE_INGEST)
    private readonly knowledgeIngestQueue: Queue<KnowledgeIngestJob>,
  ) {}

  /** GET /knowledge — status de ingestão e chunkCount por fonte. */
  async list(): Promise<KnowledgeSourceDto[]> {
    const sources = await this.prisma.tenant.knowledgeSource.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return sources.map((source) => this.toDto(source));
  }

  /** POST /knowledge — cria PENDING e enfileira `knowledge-ingest` (CONTRACTS §4). */
  async create(dto: CreateKnowledgeSourceDto): Promise<KnowledgeSourceDto> {
    const needsText = dto.type === SourceType.TEXT || dto.type === SourceType.TABLE;
    if (needsText && !dto.contentText) {
      throw new BadRequestException(`contentText é obrigatório para fontes ${dto.type}`);
    }
    if (!needsText && !dto.contentUrl) {
      throw new BadRequestException(`contentUrl é obrigatório para fontes ${dto.type}`);
    }
    if (dto.contentText) assertKnowledgeContentIsSafe(dto.contentText);

    const source = await this.prisma.tenant.knowledgeSource.create({
      data: {
        // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
        orgId: this.tenancy.getOrgIdOrThrow(),
        type: dto.type,
        name: dto.name,
        // conteúdo bruto vive em meta até a ingestão; o serviço de IA gera os chunks
        meta: {
          ...(dto.contentText ? { contentText: dto.contentText } : {}),
          ...(dto.contentUrl ? { contentUrl: dto.contentUrl } : {}),
          authority: dto.authority ?? 50,
          ...(dto.validUntil ? { validUntil: dto.validUntil } : {}),
        },
      },
    });

    await this.audit.log({
      action: 'knowledge.create',
      entity: 'KnowledgeSource',
      entityId: source.id,
      meta: { type: dto.type, name: dto.name },
    });
    await this.knowledgeIngestQueue.add('ingest', {
      orgId: this.tenancy.getOrgIdOrThrow(),
      sourceId: source.id,
    });

    return this.toDto(source);
  }

  /** DELETE /knowledge/:id — chunks caem em cascata (schema). */
  async remove(id: string): Promise<{ success: true }> {
    const source = await this.prisma.tenant.knowledgeSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Fonte de conhecimento não encontrada');
    }
    await this.prisma.tenant.knowledgeSource.delete({ where: { id } });
    await this.audit.log({ action: 'knowledge.delete', entity: 'KnowledgeSource', entityId: id });
    return { success: true };
  }

  /** Regera os chunks/vetores da fonte com o provedor de embeddings ativo. */
  async reingest(id: string): Promise<KnowledgeSourceDto> {
    const source = await this.prisma.tenant.knowledgeSource.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Fonte de conhecimento não encontrada');
    }
    if (source.status === IngestStatus.PROCESSING) {
      throw new BadRequestException('A fonte já está sendo processada');
    }

    const pending = await this.prisma.tenant.knowledgeSource.update({
      where: { id },
      data: { status: IngestStatus.PENDING },
    });
    await this.knowledgeIngestQueue.add(
      'ingest',
      { orgId: this.tenancy.getOrgIdOrThrow(), sourceId: id },
      { jobId: `reingest-${id}-${Date.now()}` },
    );
    await this.audit.log({
      action: 'knowledge.reingest',
      entity: 'KnowledgeSource',
      entityId: id,
    });
    return this.toDto(pending);
  }

  async listCandidates(): Promise<LearningCandidateDto[]> {
    const since90d = new Date(Date.now() - 90 * 86_400_000);
    const [rows, recent] = await Promise.all([
      this.prisma.tenant.learningCandidate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.tenant.learningCandidate.findMany({
        where: { status: LearningCandidateStatus.PENDING, createdAt: { gte: since90d } },
        select: { fingerprint: true },
        take: 2_000,
      }),
    ]);
    const recurrence = new Map<string, number>();
    for (const item of recent) {
      recurrence.set(item.fingerprint, (recurrence.get(item.fingerprint) ?? 0) + 1);
    }
    rows.sort((left, right) => (
      (recurrence.get(right.fingerprint) ?? 0) - (recurrence.get(left.fingerprint) ?? 0)
      || right.qualityScore - left.qualityScore
      || right.createdAt.getTime() - left.createdAt.getTime()
    ));
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      intent: row.intent,
      content: row.content,
      status: row.status,
      qualityScore: row.qualityScore,
      recurrenceCount: recurrence.get(row.fingerprint) ?? 0,
      autoPublishEligible: row.autoPublishEligible,
      autoPublishedAt: row.autoPublishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listPatterns(): Promise<LearningPatternDto[]> {
    const now = Date.now();
    const since90d = new Date(now - 90 * 86_400_000);
    const rows = await this.prisma.tenant.learningCandidate.findMany({
      where: { createdAt: { gte: since90d } },
      orderBy: { createdAt: 'desc' },
      select: { fingerprint: true, intent: true, content: true, qualityScore: true, createdAt: true },
    });
    const patterns = new Map<string, LearningPatternDto & { qualityTotal: number }>();
    for (const row of rows) {
      const ageDays = (now - row.createdAt.getTime()) / 86_400_000;
      const pattern = patterns.get(row.fingerprint) ?? {
        fingerprint: row.fingerprint,
        intent: row.intent,
        sample: row.content,
        occurrences7d: 0,
        occurrences30d: 0,
        occurrences90d: 0,
        previous30d: 0,
        growthPercent: null,
        averageQuality: 0,
        qualityTotal: 0,
      };
      pattern.occurrences90d += 1;
      if (ageDays <= 7) pattern.occurrences7d += 1;
      if (ageDays <= 30) pattern.occurrences30d += 1;
      else if (ageDays <= 60) pattern.previous30d += 1;
      pattern.qualityTotal += row.qualityScore;
      patterns.set(row.fingerprint, pattern);
    }
    return [...patterns.values()]
      .map(({ qualityTotal, ...pattern }) => ({
        ...pattern,
        averageQuality: Number((qualityTotal / pattern.occurrences90d).toFixed(2)),
        growthPercent: pattern.previous30d === 0
          ? (pattern.occurrences30d > 0 ? 100 : null)
          : Math.round(((pattern.occurrences30d - pattern.previous30d) / pattern.previous30d) * 100),
      }))
      .sort((a, b) => b.occurrences30d - a.occurrences30d || b.occurrences7d - a.occurrences7d)
      .slice(0, 100);
  }

  async approveCandidate(id: string, reviewerId: string): Promise<KnowledgeSourceDto> {
    const candidate = await this.prisma.tenant.learningCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidato de aprendizado não encontrado');
    if (candidate.status !== LearningCandidateStatus.PENDING) {
      throw new BadRequestException('Candidato já foi revisado');
    }
    const provisional = candidate.publishedSourceId
      ? await this.prisma.tenant.knowledgeSource.findUnique({ where: { id: candidate.publishedSourceId } })
      : null;
    const source = provisional
      ? await this.prisma.tenant.knowledgeSource.update({
        where: { id: provisional.id },
        data: {
          meta: {
            ...this.metaOf(provisional.meta), governance: 'APPROVED', weeklyReviewRequired: false,
            reviewedById: reviewerId, reviewedAt: new Date().toISOString(),
          },
        },
      })
      : await this.createReviewedCandidateSource(candidate.content, candidate.intent);
    await this.prisma.tenant.learningCandidate.update({
      where: { id },
      data: { status: LearningCandidateStatus.APPROVED, reviewedById: reviewerId, reviewedAt: new Date() },
    });
    await this.audit.log({ action: 'learning-candidate.approve', entity: 'LearningCandidate', entityId: id });
    return this.toDto(source);
  }

  async rejectCandidate(id: string, reviewerId: string): Promise<{ success: true }> {
    const candidate = await this.prisma.tenant.learningCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidato de aprendizado não encontrado');
    if (candidate.status !== LearningCandidateStatus.PENDING) {
      throw new BadRequestException('Candidato já foi revisado');
    }
    if (candidate.publishedSourceId) {
      await this.prisma.tenant.knowledgeSource.deleteMany({ where: { id: candidate.publishedSourceId } });
    }
    await this.prisma.tenant.learningCandidate.update({
      where: { id },
      data: { status: LearningCandidateStatus.REJECTED, reviewedById: reviewerId, reviewedAt: new Date() },
    });
    await this.audit.log({ action: 'learning-candidate.reject', entity: 'LearningCandidate', entityId: id });
    return { success: true };
  }

  private toDto(source: KnowledgeSource): KnowledgeSourceDto {
    const meta = this.metaOf(source.meta);
    const authority = typeof meta.authority === 'number' ? meta.authority : 50;
    const validUntil = typeof meta.validUntil === 'string' ? meta.validUntil : null;
    return {
      id: source.id,
      type: source.type,
      name: source.name,
      status: source.status,
      chunkCount: source.chunkCount,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      authority,
      validUntil,
    };
  }

  private async createReviewedCandidateSource(content: string, intent: string | null): Promise<KnowledgeSource> {
    assertKnowledgeContentIsSafe(content);
    const orgId = this.tenancy.getOrgIdOrThrow();
    const source = await this.prisma.tenant.knowledgeSource.create({
      data: {
        orgId, type: SourceType.TEXT,
        name: `Solução humana revisada - ${intent ?? 'atendimento geral'}`,
        meta: { contentText: content, authority: 50, governance: 'APPROVED', origin: 'HUMAN_REVIEWED_CASE' },
      },
    });
    await this.knowledgeIngestQueue.add('ingest', { orgId, sourceId: source.id });
    return source;
  }

  private metaOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
