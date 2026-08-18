import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { RunStatus, type Automation, type Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import {
  evaluateCondition,
  parseAction,
  parseCondition,
  parseTrigger,
  type AutomationAction,
} from '../../automations/automation.types';
import { conversationInclude, toConversationDto } from '../../common/serializers';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { QUEUES, type AutomationRunJob } from '../queues.constants';

/**
 * Processor `automation-run` (CONTRACTS §4): motor de automações.
 * Carrega as Automations habilitadas da org cujo trigger.event case com o
 * evento, avalia conditions sobre o context e executa actions na conversa
 * (assign, add_tag, move_stage, set_status, disable_ai). Cada execução grava
 * AutomationRun {status, log, durationMs} e incrementa runCount.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload;
 * toda entidade referenciada por action é validada contra a org antes de aplicar.
 */
@Processor(QUEUES.AUTOMATION_RUN)
export class AutomationRunProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationRunProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
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
      select: { id: true },
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
      results.push(await this.executeAction(orgId, conversationId, action));
    }
    return results;
  }

  private async executeAction(
    orgId: string,
    conversationId: string,
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
