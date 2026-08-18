import 'reflect-metadata';
import { RunStatus, TemplateStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationRunProcessor } from './automation-run.processor';
import type { AutomationRunJob } from '../queues.constants';

/**
 * AutomationRunProcessor — action `send_template` (CONTRACTS §12): a peça
 * central desta wave. Antes desta wave não havia NENHUM spec cobrindo este
 * processor (achado do crítico) — a ausência de teste é a razão pela qual a
 * quebra total de `send_template` (nunca reconhecida por parseAction) passou
 * despercebida. Segue o padrão de mocks hand-rolled do resto do repo.
 */

const ORG_ID = 'org_seeg';
const CONVERSATION_ID = 'conv_1';
const CHANNEL_ID = 'ch_wa1';
const AUTOMATION_ID = 'auto_1';
const TEMPLATE_ID = 'tpl_1';

function automationFixture(actions: unknown[]) {
  return {
    id: AUTOMATION_ID,
    orgId: ORG_ID,
    name: 'Envia boas-vindas',
    enabled: true,
    trigger: { event: 'conversation.created' },
    conditions: [],
    actions,
    runCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function conversationFixture() {
  return {
    id: CONVERSATION_ID,
    orgId: ORG_ID,
    channelId: CHANNEL_ID,
    contactId: 'contact_1',
    status: 'OPEN',
    assigneeId: null,
    stageId: null,
    stagePosition: 0,
    aiEnabled: true,
    unreadCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    contact: {
      id: 'contact_1',
      orgId: ORG_ID,
      name: 'Ana',
      phone: '5511999999999',
      email: null,
      avatarUrl: null,
      notes: null,
      customFields: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    assignee: null,
    channel: { id: CHANNEL_ID, type: 'WHATSAPP' },
    tags: [],
  };
}

function templateFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TEMPLATE_ID,
    orgId: ORG_ID,
    channelId: CHANNEL_ID,
    name: 'hello_world',
    language: 'pt_BR',
    category: 'MARKETING',
    status: TemplateStatus.APPROVED,
    components: [],
    bodyParamsCount: 1,
    metaTemplateId: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const conversation = conversationFixture();
  const createdMessages: Array<Record<string, unknown>> = [];

  const prismaSystem = {
    automation: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    conversation: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(conversation)),
      update: vi.fn().mockResolvedValue({}),
    },
    messageTemplate: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    message: {
      update: vi.fn().mockResolvedValue({}),
    },
    automationRun: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          message: {
            create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
              const created = {
                id: `msg_${createdMessages.length + 1}`,
                ...data,
                createdAt: new Date('2026-01-02T00:00:00.000Z'),
                updatedAt: new Date('2026-01-02T00:00:00.000Z'),
                author: null,
              };
              createdMessages.push(created);
              return Promise.resolve(created);
            }),
          },
          conversation: {
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      },
    ),
  };

  const prisma = { prismaSystem };
  const realtime = {
    emitMessageNew: vi.fn(),
    emitConversationUpdated: vi.fn(),
  };
  const messageOutboundQueue = { add: vi.fn().mockResolvedValue(undefined) };

  const processor = new AutomationRunProcessor(
    prisma as never,
    realtime as never,
    messageOutboundQueue as never,
  );

  return { processor, prismaSystem, realtime, messageOutboundQueue, createdMessages };
}

function jobFor(): Job<AutomationRunJob> {
  return {
    data: {
      orgId: ORG_ID,
      event: 'conversation.created',
      context: { conversationId: CONVERSATION_ID },
    },
  } as unknown as Job<AutomationRunJob>;
}

describe('AutomationRunProcessor — action send_template', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('caminho feliz: cria Message TEMPLATE, enfileira message-outbound e marca a run SUCCESS', async () => {
    const automation = automationFixture([
      { type: 'send_template', templateId: TEMPLATE_ID, params: ['Ana'] },
    ]);
    harness.prismaSystem.automation.findMany.mockResolvedValue([automation]);
    harness.prismaSystem.messageTemplate.findFirst.mockResolvedValue(templateFixture());

    await harness.processor.process(jobFor());

    expect(harness.prismaSystem.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID, orgId: ORG_ID, channelId: CHANNEL_ID },
    });
    expect(harness.createdMessages).toHaveLength(1);
    expect(harness.createdMessages[0]).toMatchObject({
      orgId: ORG_ID,
      conversationId: CONVERSATION_ID,
      direction: 'OUTBOUND',
      type: 'TEMPLATE',
      status: 'PENDING',
      content: { templateName: 'hello_world', language: 'pt_BR', params: ['Ana'] },
    });
    expect(harness.messageOutboundQueue.add).toHaveBeenCalledWith('deliver', {
      orgId: ORG_ID,
      messageId: 'msg_1',
    });
    expect(harness.realtime.emitMessageNew).toHaveBeenCalledTimes(1);
    expect(harness.realtime.emitConversationUpdated).toHaveBeenCalledTimes(1);

    expect(harness.prismaSystem.automationRun.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RunStatus.SUCCESS,
          automationId: AUTOMATION_ID,
          conversationId: CONVERSATION_ID,
        }),
      }),
    );
    expect(harness.prismaSystem.automation.update).toHaveBeenCalledWith({
      where: { id: AUTOMATION_ID },
      data: { runCount: { increment: 1 } },
    });
  });

  it('template inexistente para o canal da conversa → applied:false, run FAILED, nada enfileirado', async () => {
    const automation = automationFixture([
      { type: 'send_template', templateId: 'tpl_ghost', params: [] },
    ]);
    harness.prismaSystem.automation.findMany.mockResolvedValue([automation]);
    harness.prismaSystem.messageTemplate.findFirst.mockResolvedValue(null);

    await harness.processor.process(jobFor());

    expect(harness.messageOutboundQueue.add).not.toHaveBeenCalled();
    expect(harness.realtime.emitConversationUpdated).not.toHaveBeenCalled();
    expect(harness.prismaSystem.automationRun.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RunStatus.FAILED,
          log: expect.objectContaining({
            actions: [
              expect.objectContaining({
                type: 'send_template',
                applied: false,
                detail: expect.stringContaining('inexistente'),
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('template não aprovado (PENDING/REJECTED/PAUSED) → applied:false, não envia', async () => {
    const automation = automationFixture([
      { type: 'send_template', templateId: TEMPLATE_ID, params: [] },
    ]);
    harness.prismaSystem.automation.findMany.mockResolvedValue([automation]);
    harness.prismaSystem.messageTemplate.findFirst.mockResolvedValue(
      templateFixture({ status: TemplateStatus.PENDING, bodyParamsCount: 0 }),
    );

    await harness.processor.process(jobFor());

    expect(harness.messageOutboundQueue.add).not.toHaveBeenCalled();
    expect(harness.createdMessages).toHaveLength(0);
  });

  it('params.length !== bodyParamsCount → applied:false com detalhe do descompasso', async () => {
    const automation = automationFixture([
      { type: 'send_template', templateId: TEMPLATE_ID, params: [] }, // template exige 1
    ]);
    harness.prismaSystem.automation.findMany.mockResolvedValue([automation]);
    harness.prismaSystem.messageTemplate.findFirst.mockResolvedValue(
      templateFixture({ bodyParamsCount: 1 }),
    );

    await harness.processor.process(jobFor());

    expect(harness.messageOutboundQueue.add).not.toHaveBeenCalled();
    expect(harness.prismaSystem.automationRun.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({
          log: expect.objectContaining({
            actions: [
              expect.objectContaining({
                applied: false,
                detail: expect.stringContaining('esperado 1'),
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('falha ao enfileirar message-outbound → Message marcada FAILED e action applied:false', async () => {
    const automation = automationFixture([
      { type: 'send_template', templateId: TEMPLATE_ID, params: ['Ana'] },
    ]);
    harness.prismaSystem.automation.findMany.mockResolvedValue([automation]);
    harness.prismaSystem.messageTemplate.findFirst.mockResolvedValue(templateFixture());
    harness.messageOutboundQueue.add.mockRejectedValue(new Error('redis indisponível'));

    await harness.processor.process(jobFor());

    expect(harness.prismaSystem.message.update).toHaveBeenCalledWith({
      where: { id: 'msg_1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(harness.realtime.emitConversationUpdated).not.toHaveBeenCalled();
  });
});
