import 'reflect-metadata';
import { ChannelType, ConversationStatus, type Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsService } from './conversations.service';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

/**
 * ConversationsService.update — gatilho `memory-summarize` (CONTRACTS §15):
 * enfileira SOMENTE na transição PARA RESOLVED vinda de um status que NÃO
 * era RESOLVED — idempotência (RESOLVED→RESOLVED e reaberturas não
 * re-disparam). Segue o padrão de mocks hand-rolled do resto do repo.
 */

const ORG_ID = 'org_seeg';
const CONVERSATION_ID = 'conv_1';
const CONTACT_ID = 'contact_1';
const ACTOR = { userId: 'user_1', orgId: ORG_ID, role: 'AGENT' as Role };

function conversationFixture(status: ConversationStatus) {
  return {
    id: CONVERSATION_ID,
    orgId: ORG_ID,
    contactId: CONTACT_ID,
    channelId: 'ch_1',
    status,
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
      id: CONTACT_ID,
      orgId: ORG_ID,
      name: 'Ana',
      phone: null,
      email: null,
      avatarUrl: null,
      notes: null,
      customFields: {},
      memorySummary: null,
      memoryUpdatedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    assignee: null,
    channel: { id: 'ch_1', type: ChannelType.WHATSAPP },
    tags: [],
  };
}

function createHarness(initialStatus: ConversationStatus) {
  let current = conversationFixture(initialStatus);

  const tenant = {
    conversation: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(current)),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        current = { ...current, ...data } as typeof current;
        return Promise.resolve(current);
      }),
    },
    user: { findFirst: vi.fn() },
    pipelineStage: { findFirst: vi.fn() },
  };
  const prisma = { tenant };
  const realtime = { emitConversationUpdated: vi.fn(), emitConversationMoved: vi.fn() };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue(ORG_ID) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const memorySummarizeQueue = { add: vi.fn().mockResolvedValue(undefined) };

  const service = new ConversationsService(
    prisma as never,
    realtime as never,
    tenancy as never,
    audit as never,
    memorySummarizeQueue as never,
  );

  return { service, tenant, realtime, tenancy, audit, memorySummarizeQueue };
}

describe('ConversationsService.update — gatilho memory-summarize (CONTRACTS §15)', () => {
  let harness: ReturnType<typeof createHarness>;

  it('OPEN → RESOLVED enfileira memory-summarize uma vez com {orgId, contactId, conversationId}', async () => {
    harness = createHarness(ConversationStatus.OPEN);
    const dto: UpdateConversationDto = { status: ConversationStatus.RESOLVED };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).toHaveBeenCalledExactlyOnceWith('summarize', {
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
    });
  });

  it('PENDING → RESOLVED também enfileira (qualquer status anterior não-RESOLVED)', async () => {
    harness = createHarness(ConversationStatus.PENDING);
    const dto: UpdateConversationDto = { status: ConversationStatus.RESOLVED };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).toHaveBeenCalledExactlyOnceWith('summarize', {
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
    });
  });

  it('RESOLVED → RESOLVED (idempotência) não re-enfileira', async () => {
    harness = createHarness(ConversationStatus.RESOLVED);
    const dto: UpdateConversationDto = { status: ConversationStatus.RESOLVED };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).not.toHaveBeenCalled();
  });

  it('RESOLVED → OPEN (reabertura) não enfileira', async () => {
    harness = createHarness(ConversationStatus.RESOLVED);
    const dto: UpdateConversationDto = { status: ConversationStatus.OPEN };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).not.toHaveBeenCalled();
  });

  it('update sem campo status (ex.: só assigneeId) não enfileira', async () => {
    harness = createHarness(ConversationStatus.OPEN);
    harness.tenant.user.findFirst.mockResolvedValue({ id: 'user_2' });
    const dto: UpdateConversationDto = { assigneeId: 'user_2' };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).not.toHaveBeenCalled();
  });

  it('update sem campo status (ex.: só stageId) não enfileira', async () => {
    harness = createHarness(ConversationStatus.OPEN);
    harness.tenant.pipelineStage.findFirst.mockResolvedValue({ id: 'stage_2' });
    const dto: UpdateConversationDto = { stageId: 'stage_2' };

    await harness.service.update(CONVERSATION_ID, dto, ACTOR);

    expect(harness.memorySummarizeQueue.add).not.toHaveBeenCalled();
  });
});
