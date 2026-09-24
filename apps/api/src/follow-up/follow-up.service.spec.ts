import { FollowUpStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpService } from './follow-up.service';

const ORG_ID = 'org_test';
const CONTACT_ID = 'contact_test';
const CONVERSATION_ID = 'conversation_instagram';

function createHarness() {
  const prismaSystem = {
    followUpSequence: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([{ id: 'follow_up_whatsapp' }]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    conversation: { findFirst: vi.fn() },
  };
  const audit = { logSystem: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn() };
  return {
    prismaSystem,
    audit,
    queue,
    service: new FollowUpService({ prismaSystem } as never, audit as never, queue as never),
  };
}

describe('FollowUpService cross-channel continuity', () => {
  it('pauses a pending follow-up when the same contact returns through another channel', async () => {
    const harness = createHarness();

    await harness.service.observeInbound({
      orgId: ORG_ID,
      conversationId: CONVERSATION_ID,
      contactId: CONTACT_ID,
      content: { text: 'Olá, voltei por aqui.' },
    });

    expect(harness.prismaSystem.followUpSequence.findMany).toHaveBeenCalledWith({
      where: {
        orgId: ORG_ID,
        conversationId: { not: CONVERSATION_ID },
        status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.READY_FOR_REVIEW] },
        conversation: { contactId: CONTACT_ID },
      },
      select: { id: true },
    });
    expect(harness.prismaSystem.followUpSequence.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['follow_up_whatsapp'] } },
      data: {
        status: FollowUpStatus.PAUSED,
        pausedReason: 'cliente_respondeu_em_outro_canal',
        nextRunAt: null,
      },
    });
    expect(harness.audit.logSystem).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      action: 'follow-up.paused-by-contact-inbound',
      meta: expect.objectContaining({ sequences: 1 }),
    }));
    expect(harness.prismaSystem.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('cancels cross-channel follow-ups when the client opts out', async () => {
    const harness = createHarness();

    await harness.service.observeInbound({
      orgId: ORG_ID,
      conversationId: CONVERSATION_ID,
      contactId: CONTACT_ID,
      content: { text: 'Por favor, não quero mais receber mensagens.' },
    });

    expect(harness.prismaSystem.followUpSequence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: FollowUpStatus.CANCELLED,
        pausedReason: 'opt_out_do_cliente_em_outro_canal',
      }),
    }));
  });
});
