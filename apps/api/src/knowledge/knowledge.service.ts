import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SourceType, type IngestStatus, type KnowledgeSource } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type KnowledgeIngestJob } from '../queues/queues.constants';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateKnowledgeSourceDto } from './dto/create-knowledge-source.dto';

export interface KnowledgeSourceDto {
  id: string;
  type: SourceType;
  name: string;
  status: IngestStatus;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
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

  private toDto(source: KnowledgeSource): KnowledgeSourceDto {
    return {
      id: source.id,
      type: source.type,
      name: source.name,
      status: source.status,
      chunkCount: source.chunkCount,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }
}
