import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { IngestStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AiServiceClient } from '../ai-service.client';
import { QUEUES, type KnowledgeIngestJob } from '../queues.constants';

/**
 * Processor `knowledge-ingest` (CONTRACTS §4/§7): dispara a ingestão no FastAPI.
 * O serviço de IA processa async (chunking + embeddings + pgvector) e atualiza
 * `knowledge_sources.status/chunk_count` DIRETO no Postgres — aqui só marcamos
 * PROCESSING e entregamos o job. Falha na chamada → FAILED + retry do BullMQ.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload.
 */
@Processor(QUEUES.KNOWLEDGE_INGEST)
export class KnowledgeIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiServiceClient,
  ) {
    super();
  }

  async process(job: Job<KnowledgeIngestJob>): Promise<void> {
    const { orgId, sourceId } = job.data;

    const source = await this.prisma.prismaSystem.knowledgeSource.findFirst({
      where: { id: sourceId, orgId },
    });
    if (!source) {
      this.logger.warn(`KnowledgeSource ${sourceId} não encontrada (org=${orgId}) — descartado`);
      return;
    }
    if (source.status === IngestStatus.READY) {
      return; // idempotência: retry de ingestão já concluída
    }

    const meta =
      typeof source.meta === 'object' && source.meta !== null && !Array.isArray(source.meta)
        ? (source.meta as Record<string, unknown>)
        : {};
    const contentText = typeof meta.contentText === 'string' ? meta.contentText : undefined;
    const contentUrl = typeof meta.contentUrl === 'string' ? meta.contentUrl : undefined;

    await this.prisma.prismaSystem.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: IngestStatus.PROCESSING },
    });

    try {
      await this.aiClient.ingest({
        org_id: orgId,
        source_id: sourceId,
        type: source.type,
        ...(contentUrl ? { content_url: contentUrl } : {}),
        ...(contentText ? { content_text: contentText } : {}),
        meta: { name: source.name },
      });
    } catch (error) {
      await this.prisma.prismaSystem.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: IngestStatus.FAILED },
      });
      throw error; // BullMQ faz retry (attempts: 3, backoff exponencial)
    }
  }
}
