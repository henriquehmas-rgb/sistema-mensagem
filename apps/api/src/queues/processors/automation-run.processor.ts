import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  RunStatus,
  TemplateStatus,
  type Automation,
  type Prisma,
} from '@prisma/client';
import { Queue, type Job } from 'bullmq';
import {
  evaluateCondition,
  parseAction,
  parseCondition,
  parseTrigger,
  type AutomationAction,
} from '../../automations/automation.types';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
} from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { QUEUES, type AutomationRunJob, type MessageOutboundJob } from '../queues.constants';

/**
 * Processor `automation-run` (CONTRACTS §4): motor de automações.
 * Carrega as Automations habilitadas da org cujo trigger.event case com o
 * evento, avalia conditions sobre o context e executa actions na conversa
 * (assign, add_tag, move_stage, set_status, disable_ai, send_template).
 * `send_template` (CONTRACTS §12) resolve o MessageTemplate por
 * (id, orgId, channelId da conversa), valida status APPROVED e
 * params.length===bodyParamsCount, cria a Message OUTBOUND PENDING e
 * enfileira `message-outbound` — mesma trilha de MessagesService.send.
 * Cada execução grava AutomationRun {status, log, durationMs} e incrementa
 * runCount.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload;
 * toda entidade referenciada por action é validada contra a org antes de aplicar.
 */
@Processor(QUEUES.AUTOMATION_RUN)
export class AutomationRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationRunProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND)
    private readonly messageOutboundQueue: Queue<MessageOutboundJob>,
  ) {
    super();
  }

  async process(job: Job<AutomationRunJob>): Promise<void> {
    const { orgId, event } = job.data;

    const automations = await this.prisma.prismaSystem.automation.findMany({
      where: { orgId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const matching = automations.filter((automation) => {
      const trigger = parseTrigger(automation.trigger);
      return trigger?.event === event;
    });

    for (const automation of matching) {
      await this.runAutomation(automation, job.data);
    }
  }

  private async runAutomation(automation: Automation, jobData: AutomationRunJob): Promise<void> {
    const startedAt = Date.now();
    const { orgId, event, context } = jobData;
    const conversationId =
      typeof context.conversationId === 'string' ? context.conversationId : null;
    const log: Record<string, unknown> = { event };

    let status: RunStatus = RunStatus.SUCCESS;
    let touchedConversation = false;

    try {
      const conditions = Array.isArray(automation.conditions)
        ? automation.conditions.map(parseCondition)
        : [];
      const invalidCondition = conditions.some((condition) => condition === null);
      const passed =
        !invalidCondition &&
        conditions.every((condition) => condition && evaluateCondition(condition, context));

      if (invalidCondition) {
        status = RunStatus.SKIPPED;
        log.reason = 'condição com forma inválida';
      } else if (!passed) {
        status = RunStatus.SKIPPED;
        log.reason = 'condições não satisfeitas';
      } else if (!conversationId) {
        status = RunStatus.SKIPPED;
        log.reason = 'evento sem conversationId no context';
      } else {
        const results = await this.executeActions(orgId, conversationId, automation);
        log.actions = results;
        touchedConversation = results.some((result) => result.applied);
        if (results.some((result) => !result.applied)) {
          status = results.every((result) => !result.applied) ? RunStatus.FAILED : RunStatus.SUCCESS;
        }
      }
    } catch (error) {
      status = RunStatus.FAILED;
      log.error = (error as Error).message;
      this.logger.warn(
        `Automação ${automation.id} falhou (org=${orgId}): ${(error as Error).message}`,
      );
    }

    await this.recordRun(automation, orgId, conversationId, status, log, Date.now() - startedAt);

    if (touchedConversation && conversationId) {
      await this.emitConversationUpdated(orgId, conversationId);
    }
  }

  private async executeActions(
    orgId: string,
    conversationId: string,
    automation: Automation,
  ): Promise<Array<{ type: string; applied: boolean; detail?: string }>> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: { id: true, channelId: true },
    });
    if (!conversation) {
      return [{ type: '*', applied: false, detail: 'conversa não encontrada na org' }];
    }

    const rawActions = Array.isArray(automation.actions) ? automation.actions : [];
    const results: Array<{ type: string; applied: boolean; detail?: string }> = [];

    for (const raw of rawActions) {
      const action = parseAction(raw);
      if (!action) {
        results.push({ type: 'unknown', applied: false, detail: 'action com forma inválida' });
        continue;
      }
      results.push(
        await this.executeAction(orgId, conversationId, conversation.channelId, action),
      );
    }
    return results;
  }

  private async executeAction(
    orgId: string,
    conversationId: string,
    channelId: string,
    action: AutomationAction,
  ): Promise<{ type: string; applied: boolean; detail?: string }> {
    switch (action.type) {
      case 'assign': {
        const user = await this.prisma.prismaSystem.user.findFirst({
          where: { id: action.userId, orgId, isActive: true },
          select: { id: true },
        });
        if (!user) {
          return { type: action.type, applied: false, detail: 'usuário inexistente/inativo' };
        }
        await this.prisma.prismaSystem.conversation.update({
          where: { id: conversationId },
          data: { assigneeId: action.userId },
        });
        return { type: action.type, applied: true };
      }
      case 'add_tag': {
        const tag = await this.prisma.prismaSystem.tag.findFirst({
          where: { id: action.tagId, orgId },
          select: { id: true },
        });
        if (!tag) {
          return { type: action.type, applied: false, detail: 'tag inexistente na org' };
        }
        await this.prisma.prismaSystem.conversationTag.upsert({
          where: { conversationId_tagId: { conversationId, tagId: action.tagId } },
          create: { conversationId, tagId: action.tagId },
          update: {},
        });
        return { type: action.type, applied: true };
      }
      case 'move_stage': {
        const stage = await this.prisma.prismaSystem.pipelineStage.findFirst({
          where: { id: action.stageId, orgId },
          select: { id: true },
        });
        if (!stage) {
          return { type: action.type, applied: false, detail: 'stage inexistente na org' };
        }
        await this.prisma.prismaSystem.conversation.update({
          where: { id: conversationId },
          data: { stageId: action.stageId },
        });
        return { type: action.type, applied: true };
      }
      case 'set_status':
        await this.prisma.prismaSystem.conversation.update({
          where: { id: conversationId },
          data: { status: action.status },
        });
        return { type: action.type, applied: true };
      case 'disable_ai':
        await this.prisma.prismaSystem.conversation.update({
          where: { id: conversationId },
          data: { aiEnabled: false },
        });
        return { type: action.type, applied: true };
      case 'send_template': {
        const template = await this.prisma.prismaSystem.messageTemplate.findFirst({
          where: { id: action.templateId, orgId, channelId },
        });
        if (!template) {
          return {
            type: action.type,
            applied: false,
            detail: 'template inexistente para o canal da conversa',
          };
        }
        if (template.status !== TemplateStatus.APPROVED) {
          return { type: action.type, applied: false, detail: 'template não está aprovado' };
        }
        const params = action.params ?? [];
        if (params.length !== template.bodyParamsCount) {
          return {
            type: action.type,
            applied: false,
            detail: `esperado ${template.bodyParamsCount} parâmetro(s), recebido ${params.length}`,
          };
        }

        const applied = await this.sendTemplateMessage(orgId, conversationId, {
          templateName: template.name,
          language: template.language,
          ...(params.length > 0 ? { params } : {}),
        });
        return { type: action.type, applied };
      }
    }
  }

  /**
   * Cria a Message OUTBOUND PENDING (mesma trilha de MessagesService.send/
   * AiReplyProcessor.handleReply) e enfileira `message-outbound` — a action
   * só é `applied:true` depois de a entrega ser enfileirada com sucesso.
   */
  private async sendTemplateMessage(
    orgId: string,
    conversationId: string,
    content: { templateName: string; language: string; params?: string[] },
  ): Promise<boolean> {
    const message = await this.prisma.prismaSystem.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          orgId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEMPLATE,
          content: content as Prisma.InputJsonValue,
          status: MessageStatus.PENDING,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: created.createdAt,
          lastMessagePreview: messagePreview(MessageType.TEMPLATE, content),
        },
      });
      return created;
    });

    try {
      await this.messageOutboundQueue.add('deliver', { orgId, messageId: message.id });
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar message-outbound (action send_template, message=${message.id}): ${(error as Error).message}`,
      );
      await this.prisma.prismaSystem.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          errorMessage: 'Falha ao enfileirar a entrega (fila indisponível)',
        },
      });
      return false;
    }

    await this.emitMessageNew(orgId, conversationId, message);
    return true;
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
    if (conversation) {
      this.realtime.emitMessageNew(orgId, {
        message: toMessageDto(message),
        conversation: toConversationDto(conversation),
      });
    }
  }

  private async recordRun(
    automation: Automation,
    orgId: string,
    conversationId: string | null,
    status: RunStatus,
    log: Record<string, unknown>,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.prismaSystem.automationRun.create({
      data: {
        orgId,
        automationId: automation.id,
        conversationId,
        status,
        log: log as Prisma.InputJsonValue,
        durationMs,
      },
    });
    if (status !== RunStatus.SKIPPED) {
      await this.prisma.prismaSystem.automation.update({
        where: { id: automation.id },
        data: { runCount: { increment: 1 } },
      });
    }
  }

  private async emitConversationUpdated(orgId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (conversation) {
      this.realtime.emitConversationUpdated(orgId, {
        conversation: toConversationDto(conversation),
      });
    }
  }
}
