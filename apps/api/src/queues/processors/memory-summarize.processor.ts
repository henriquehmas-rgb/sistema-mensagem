import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MessageDirection, MessageType, SourceType, type Message } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { assertKnowledgeContentIsSafe } from '../../knowledge/knowledge-content-safety';
import { toContactDto } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { AiServiceClient } from '../ai-service.client';
import { QUEUES, type KnowledgeIngestJob, type MemorySummarizeJob } from '../queues.constants';

/**
 * Placeholder textual para mensagens de mídia (CONTRACTS §15) — a mesma
 * conversa enviada ao serviço de IA não carrega mediaUrl/binário, só o fato
 * "o contato enviou algo desse tipo" para o resumo poder registrá-lo.
 */
const MEDIA_PLACEHOLDERS: Partial<Record<MessageType, string>> = {
  IMAGE: '[enviou uma imagem]',
  AUDIO: '[enviou um áudio]',
  VIDEO: '[enviou um vídeo]',
  DOCUMENT: '[enviou um documento]',
  STICKER: '[enviou uma figurinha]',
  LOCATION: '[enviou uma localização]',
  TEMPLATE: '[enviou um modelo de mensagem]',
};

/**
 * Processor `memory-summarize` (CONTRACTS §15): ao fim de uma conversa
 * RESOLVED ou em checkpoint substantivo e fundamentado, funde as mensagens
 * com a memória cumulativa do contato via `POST /memory/summarize` e grava o
 * resultado em `Contact.memorySummary`/`memoryUpdatedAt`.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload.
 * Fail-safe: se a chamada ao serviço de IA falhar, NADA é escrito no contato
 * (a memória anterior permanece intacta) e o erro propaga para o retry do
 * BullMQ (attempts: 3, backoff exponencial).
 */
@Processor(QUEUES.MEMORY_SUMMARIZE)
export class MemorySummarizeProcessor extends WorkerHost {
  private readonly logger = new Logger(MemorySummarizeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly aiClient: AiServiceClient,
    @InjectQueue(QUEUES.KNOWLEDGE_INGEST) private readonly knowledgeIngestQueue: Queue<KnowledgeIngestJob>,
  ) {
    super();
  }

  async process(job: Job<MemorySummarizeJob>): Promise<void> {
    const { orgId, contactId, conversationId } = job.data;

    const contact = await this.prisma.prismaSystem.contact.findFirst({
      where: { id: contactId, orgId },
    });
    if (!contact) {
      this.logger.warn(`Contato ${contactId} não encontrado (org=${orgId}) — descartado`);
      return;
    }

    const messages = await this.prisma.prismaSystem.message.findMany({
      where: { conversationId, orgId, type: { not: MessageType.SYSTEM } },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length === 0) {
      return; // conversa sem nenhuma mensagem substantiva — nada a resumir
    }

    const response = await this.aiClient.summarizeMemory({
      org_id: orgId,
      existing_summary: contact.memorySummary,
      messages: messages.map((message) => ({
        role: message.direction === MessageDirection.INBOUND ? 'user' : 'assistant',
        content: this.textOf(message),
      })),
    });

    // Fail-safe do serviço de IA pode devolver o resumo INALTERADO (timeout,
    // erro do LLM, ou nenhum fato novo relevante) — nesse caso não grava nem
    // emite, para não sugerir na UI ("Atualizado há X") uma atualização que
    // não aconteceu de fato.
    if (response.summary !== contact.memorySummary) {
      const updated = await this.prisma.prismaSystem.contact.update({
        where: { id: contactId },
        data: { memorySummary: response.summary, memoryUpdatedAt: new Date() },
      });
      this.realtime.emitContactUpdated(orgId, { contact: toContactDto(updated) });
    }

    await this.captureLearningCandidate(orgId, conversationId, messages);
  }

  /** Captura uma solução humana como PENDENTE; nunca entra direto no RAG. */
  private async captureLearningCandidate(
    orgId: string,
    conversationId: string,
    messages: Message[],
  ): Promise<void> {
    let answerIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (
        message.direction === MessageDirection.OUTBOUND &&
        message.authorId !== null &&
        !message.isAiGenerated &&
        message.type === MessageType.TEXT
      ) {
        answerIndex = index;
        break;
      }
    }
    if (answerIndex < 0) return;
    const question = [...messages.slice(0, answerIndex)].reverse().find(
      (message) => message.direction === MessageDirection.INBOUND && message.type === MessageType.TEXT,
    );
    if (!question) return;

    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: { lastIntent: true, department: { select: { routingKey: true } } },
    });
    const prepared = await this.aiClient.prepareLearningCandidate({
      question: this.textOf(question),
      answer: this.textOf(messages[answerIndex]!),
      department_key: conversation?.department?.routingKey ?? null,
    });
    if (!prepared.eligible || !prepared.content || !prepared.fingerprint) return;
    const candidate = await this.prisma.prismaSystem.learningCandidate.upsert({
      where: { orgId_conversationId: { orgId, conversationId } },
      create: {
        orgId,
        conversationId,
        intent: conversation?.lastIntent ?? null,
        content: prepared.content,
        fingerprint: prepared.fingerprint,
        qualityScore: prepared.quality_score,
        autoPublishEligible: prepared.auto_publish_eligible,
      },
      update: {
        intent: conversation?.lastIntent ?? null,
        content: prepared.content,
        fingerprint: prepared.fingerprint,
        qualityScore: prepared.quality_score,
        autoPublishEligible: prepared.auto_publish_eligible,
      },
    });
    if (prepared.auto_publish_eligible && !candidate.publishedSourceId) {
      await this.publishProvisionalTechnicalLearning({
        orgId, candidateId: candidate.id, intent: conversation?.lastIntent ?? null, content: prepared.content,
      });
    }
  }

  /** A captura continua mesmo se o uso provis�rio opcional falhar. */
  private async publishProvisionalTechnicalLearning(input: { orgId: string; candidateId: string; intent: string | null; content: string }) {
    try {
      assertKnowledgeContentIsSafe(input.content);
      const source = await this.prisma.prismaSystem.knowledgeSource.create({
        data: {
          orgId: input.orgId, type: SourceType.TEXT,
          name: `Aprendizado t�cnico em revis�o - ${input.intent ?? 'suporte'}`,
          meta: {
            contentText: input.content, authority: 20, department: 'technical_support',
            governance: 'AUTO_REVIEW_REQUIRED', origin: 'HUMAN_RESOLVED_CASE',
            learningCandidateId: input.candidateId, weeklyReviewRequired: true,
          },
        },
      });
      await this.prisma.prismaSystem.learningCandidate.update({
        where: { id: input.candidateId }, data: { autoPublishedAt: new Date(), publishedSourceId: source.id },
      });
      await this.knowledgeIngestQueue.add('ingest', { orgId: input.orgId, sourceId: source.id });
    } catch (error) {
      this.logger.warn(`Aprendizado provis�rio n�o publicado: ${(error as Error).message}`);
    }
  }

  private textOf(message: Message): string {
    if (message.type === MessageType.TEXT) {
      const content = message.content;
      if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
        const text = (content as Record<string, unknown>).text;
        if (typeof text === 'string' && text.length > 0) {
          return text;
        }
      }
      return '[mensagem de texto vazia]';
    }
    return MEDIA_PLACEHOLDERS[message.type] ?? `[${message.type.toLowerCase()}]`;
  }
}
