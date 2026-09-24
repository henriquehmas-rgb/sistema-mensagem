import { ConversationStatus, FollowUpStatus, MessageDirection, MessageStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ConversationInactivityProcessor } from './conversation-inactivity.processor';

function harness(updateCount = 1) {
  const prismaSystem = {
    conversation: {
      findMany: vi.fn().mockResolvedValue([{ id: 'conv_1', orgId: 'org_1', contactId: 'contact_1' }]),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      update: vi.fn().mockResolvedValue({ id: 'conv_1' }),
    },
    resolutionReason: { upsert: vi.fn().mockResolvedValue({ id: 'reason_inactivity' }) },
    followUpSequence: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    message: {
      findFirst: vi.fn().mockResolvedValue({ createdAt: new Date() }),
      create: vi.fn().mockResolvedValue({ id: 'closing_message', createdAt: new Date() }),
    },
  };
  const audit = { logSystem: vi.fn().mockResolvedValue(undefined) };
  const memoryQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const outboundQueue = { add: vi.fn().mockResolvedValue(undefined) };
  return {
    prismaSystem, audit, memoryQueue, outboundQueue,
    processor: new ConversationInactivityProcessor(
      { prismaSystem } as never, audit as never, memoryQueue as never, outboundQueue as never,
    ),
  };
}

describe('ConversationInactivityProcessor', () => {
  it('resolve somente conversa de IA sem atendente no canal-piloto após 30 minutos', async () => {
    const h = harness();
    await h.processor.process({} as never);

    expect(h.prismaSystem.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: [ConversationStatus.OPEN, ConversationStatus.PENDING] },
        assigneeId: null,
        aiEnabled: true,
        channel: { externalId: { in: ['896286296892823'] } },
      }),
      take: 100,
    }));
    expect(h.prismaSystem.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ConversationStatus.RESOLVED,
        resolutionNote: 'Encerrada automaticamente após 30 minutos sem interação.',
      }),
    }));
    expect(h.prismaSystem.followUpSequence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: FollowUpStatus.PAUSED, pausedReason: 'conversa_encerrada_por_inatividade', nextRunAt: null },
    }));
    expect(h.memoryQueue.add).toHaveBeenCalledWith('summarize', {
      orgId: 'org_1', contactId: 'contact_1', conversationId: 'conv_1',
    });
    expect(h.prismaSystem.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: MessageDirection.OUTBOUND, status: MessageStatus.PENDING }),
    }));
    expect(h.outboundQueue.add).toHaveBeenCalledWith('deliver', {
      orgId: 'org_1', messageId: 'closing_message',
    });
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_1', expect.objectContaining({
      action: 'conversation.resolved-by-inactivity',
    }));
  });

  it('não encerra se a conversa recebeu mensagem durante a varredura', async () => {
    const h = harness(0);
    await h.processor.process({} as never);

    expect(h.prismaSystem.followUpSequence.updateMany).not.toHaveBeenCalled();
    expect(h.memoryQueue.add).not.toHaveBeenCalled();
    expect(h.outboundQueue.add).not.toHaveBeenCalled();
    expect(h.audit.logSystem).not.toHaveBeenCalled();
  });

  it('encerra internamente sem mensagem quando a janela de 24 horas expirou', async () => {
    const h = harness();
    h.prismaSystem.message.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
    });
    await h.processor.process({} as never);

    expect(h.prismaSystem.message.create).not.toHaveBeenCalled();
    expect(h.outboundQueue.add).not.toHaveBeenCalled();
    expect(h.audit.logSystem).toHaveBeenCalledWith('org_1', expect.objectContaining({
      action: 'conversation.inactivity-closing-message.skipped-outside-whatsapp-window',
    }));
  });
});
