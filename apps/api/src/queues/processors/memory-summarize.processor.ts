import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MessageDirection, MessageType, type Message } from '@prisma/client';
import type { Job } from 'bullmq';
import { toContactDto } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { AiServiceClient } from '../ai-service.client';
import { QUEUES, type MemorySummarizeJob } from '../queues.constants';

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
 * RESOLVED, funde as mensagens dessa conversa com a memória cumulativa já
 * existente do contato via `POST /memory/summarize` (serviço de IA) e grava
 * o resultado em `Contact.memorySummary`/`memoryUpdatedAt`.
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
    if (response.summary === contact.memorySummary) {
      return;
    }

    const updated = await this.prisma.prismaSystem.contact.update({
      where: { id: contactId },
      data: { memorySummary: response.summary, memoryUpdatedAt: new Date() },
    });

    this.realtime.emitContactUpdated(orgId, { contact: toContactDto(updated) });
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
