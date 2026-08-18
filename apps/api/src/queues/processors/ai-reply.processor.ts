import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  type Message,
  type Prisma,
} from '@prisma/client';
import { Queue, type Job } from 'bullmq';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
} from '../../common/serializers';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { AiServiceClient } from '../ai-service.client';
import {
  QUEUES,
  type AiReplyJob,
  type AutomationRunJob,
  type MessageOutboundJob,
} from '../queues.constants';

const HISTORY_SIZE = 12; // CONTRACTS §7: últimas 12 mensagens no prompt
const STAGE_POSITION_GAP = 1_024;

/**
 * Processor `ai-reply` (CONTRACTS §4/§7): chama o FastAPI /reply com o histórico
 * da conversa e os dados do contato.
 * - reply → Message OUTBOUND isAiGenerated + message:new + fila message-outbound.
 * - handoff → conversa vai para o TOPO da stage isHumanHandoff, aiEnabled=false,
 *   Message SYSTEM com o handoff_reason, conversation:moved + conversation:updated.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload.
 */
@Processor(QUEUES.AI_REPLY)
export class AiReplyProcessor extends WorkerHost {
  private readonly logger = new Logger(AiReplyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly aiClient: AiServiceClient,
    private readonly metrics: MetricsService,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND)
    private readonly messageOutboundQueue: Queue<MessageOutboundJob>,
    @InjectQueue(QUEUES.AUTOMATION_RUN)
    private readonly automationRunQueue: Queue<AutomationRunJob>,
  ) {
    super();
  }

  async process(job: Job<AiReplyJob>): Promise<void> {
    const { orgId, conversationId, messageId } = job.data;

    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: { contact: true },
    });
    if (!conversation) {
      this.logger.warn(`Conversa ${conversationId} não encontrada (org=${orgId}) — descartado`);
      return;
    }
    if (!conversation.aiEnabled) {
      return; // agente humano assumiu entre o enfileiramento e o processamento
    }

    // Idempotência no retry do BullMQ: se o job falhou DEPOIS de a resposta ser
    // persistida (ex.: erro no emit ou no enqueue de message-outbound), uma nova
    // execução NÃO chama o LLM de novo — qualquer Message isAiGenerated criada a
    // partir do gatilho (reply OU handoff SYSTEM) encerra o job cedo.
    const trigger = await this.prisma.prismaSystem.message.findFirst({
      where: { id: messageId, orgId },
      select: { createdAt: true },
    });
    if (!trigger) {
      this.logger.warn(`Mensagem gatilho ${messageId} não encontrada (org=${orgId}) — descartado`);
      return;
    }
    const alreadyReplied = await this.prisma.prismaSystem.message.findFirst({
      where: {
        orgId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        isAiGenerated: true,
        createdAt: { gte: trigger.createdAt },
      },
      select: { id: true, type: true, status: true },
    });
    if (alreadyReplied) {
      // Se o retry veio de falha APÓS criar a resposta mas ANTES de enfileirar a
      // entrega, garante o enqueue (o processor de outbound é idempotente por status).
      if (
        alreadyReplied.type !== MessageType.SYSTEM &&
        alreadyReplied.status === MessageStatus.PENDING
      ) {
        await this.messageOutboundQueue.add('deliver', { orgId, messageId: alreadyReplied.id });
      }
      return;
    }

    const history = await this.prisma.prismaSystem.message.findMany({
      where: { conversationId, orgId, type: { not: MessageType.SYSTEM } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_SIZE,
    });
    history.reverse(); // ordem cronológica para o prompt

    // CONTRACTS §14: histograma ai_reply_duration_seconds — só a chamada
    // HTTP em si (exclui a leitura de histórico e a persistência abaixo).
    const start = process.hrtime.bigint();
    let response: Awaited<ReturnType<AiServiceClient['reply']>>;
    try {
      response = await this.aiClient.reply({
        org_id: orgId,
        conversation_id: conversationId,
        messages: history.map((message) => ({
          role: message.direction === MessageDirection.INBOUND ? 'user' : 'assistant',
          content: this.textOf(message),
        })),
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          phone: conversation.contact.phone,
          email: conversation.contact.email,
        },
      });
    } finally {
      this.metrics.observeAiReplyDuration(Number(process.hrtime.bigint() - start) / 1e9);
    }

    if (response.handoff) {
      await this.handleHandoff(orgId, conversationId, response.handoff_reason);
      return;
    }

    if (response.reply) {
      await this.handleReply(orgId, conversationId, response.reply);
    }
  }

  /** Cria a resposta da IA como OUTBOUND PENDING e enfileira a entrega. */
  private async handleReply(orgId: string, conversationId: string, reply: string): Promise<void> {
    const content = { text: reply };
    const message = await this.prisma.prismaSystem.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          orgId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          content,
          status: MessageStatus.PENDING,
          isAiGenerated: true,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: created.createdAt,
          lastMessagePreview: messagePreview(MessageType.TEXT, content),
        },
      });
      return created;
    });

    await this.emitMessageNew(orgId, conversationId, message);
    await this.messageOutboundQueue.add('deliver', { orgId, messageId: message.id });
  }

  /** Move para a stage de intervenção humana (topo) e registra Message SYSTEM. */
  private async handleHandoff(
    orgId: string,
    conversationId: string,
    reason: string | undefined,
  ): Promise<void> {
    const handoffStage = await this.prisma.prismaSystem.pipelineStage.findFirst({
      where: { orgId, isHumanHandoff: true },
      orderBy: { position: 'asc' },
    });

    const data: Prisma.ConversationUpdateInput = { aiEnabled: false };
    let stagePosition: number | null = null;

    if (handoffStage) {
      const min = await this.prisma.prismaSystem.conversation.aggregate({
        where: { orgId, stageId: handoffStage.id },
        _min: { stagePosition: true },
      });
      stagePosition = (min._min.stagePosition ?? 0) - STAGE_POSITION_GAP;
      data.stage = { connect: { id: handoffStage.id } };
      data.stagePosition = stagePosition;
    } else {
      this.logger.warn(`Org ${orgId} sem stage isHumanHandoff — handoff só desliga a IA`);
    }

    await this.prisma.prismaSystem.conversation.update({
      where: { id: conversationId },
      data,
    });

    // Mensagem SYSTEM visível na timeline com o motivo do handoff.
    const systemMessage = await this.prisma.prismaSystem.message.create({
      data: {
        orgId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.SYSTEM,
        content: {
          text: 'Conversa transferida para atendimento humano',
          handoff_reason: reason ?? 'não informado',
        },
        status: MessageStatus.SENT,
        isAiGenerated: true,
      },
      include: messageInclude,
    });

    if (handoffStage && stagePosition !== null) {
      this.realtime.emitConversationMoved(orgId, {
        conversationId,
        stageId: handoffStage.id,
        stagePosition,
        movedBy: null, // movido pela IA, não por um usuário
      });
    }
    await this.emitConversationUpdated(orgId, conversationId);
    await this.emitMessageNew(orgId, conversationId, systemMessage);

    await this.automationRunQueue.add('conversation.handoff', {
      orgId,
      event: 'conversation.handoff',
      context: {
        conversationId,
        stageId: handoffStage?.id ?? null,
        reason: reason ?? null,
      },
    });
  }

  private async emitMessageNew(
    orgId: string,
    conversationId: string,
    message: Parameters<typeof toMessageDto>[0],
  ): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitMessageNew(orgId, {
      message: toMessageDto(message),
      conversation: toConversationDto(conversation),
    });
  }

  private async emitConversationUpdated(orgId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitConversationUpdated(orgId, { conversation: toConversationDto(conversation) });
  }

  private textOf(message: Message): string {
    const content = message.content;
    if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
      const text = (content as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        return text;
      }
    }
    return `[${message.type.toLowerCase()}]`;
  }
}
