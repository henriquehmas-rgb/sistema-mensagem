import 'reflect-metadata';
import { MessageStatus, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { MessageOutboundJob } from '../queues.constants';
import { MessageOutboundProcessor } from './message-outbound.processor';

function harness(channelType: 'WHATSAPP' | 'INSTAGRAM') {
  const message = {
    id: 'msg1', orgId: 'org1', conversationId: 'conv1', status: MessageStatus.PENDING,
    type: MessageType.TEXT, content: { text: 'teste' },
    conversation: { id: 'conv1', channelId: 'channel1', contactId: 'contact1' },
  };
  const prismaSystem = {
    message: {
      findFirst: vi.fn().mockResolvedValue(message),
      update: vi.fn().mockResolvedValue({ authorId: null, isAiGenerated: true }),
    },
    channel: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'channel1', orgId: 'org1', type: channelType, externalId: 'external', encryptedCredentials: 'configured',
      }),
    },
    contactIdentity: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
  };
  const realtime = { emitMessageStatus: vi.fn() };
  const metaGraph = { sendWhatsAppMessage: vi.fn(), sendInstagramMessage: vi.fn() };
  const followUp = { recordHumanDelivery: vi.fn() };
  const operationalIncidents = { record: vi.fn() };
  return {
    prismaSystem, realtime, metaGraph,
    processor: new MessageOutboundProcessor(
      { prismaSystem } as never, realtime as never, metaGraph as never, followUp as never,
      operationalIncidents as never,
    ),
    operationalIncidents,
  };
}

describe('MessageOutboundProcessor — trava de entrega externa', () => {
  it.each(['WHATSAPP', 'INSTAGRAM'] as const)(
    'não usa %s mesmo se houver credenciais fora do escopo do piloto',
    async (channelType) => {
      const h = harness(channelType);
      await h.processor.process({ data: { orgId: 'org1', messageId: 'msg1' } } as Job<MessageOutboundJob>);

      expect(h.metaGraph.sendWhatsAppMessage).not.toHaveBeenCalled();
      expect(h.metaGraph.sendInstagramMessage).not.toHaveBeenCalled();
      expect(h.prismaSystem.message.update).toHaveBeenCalledWith({
        where: { id: 'msg1' },
        data: {
          status: MessageStatus.FAILED,
          errorMessage: 'Entrega externa bloqueada: canal fora do escopo do piloto controlado',
        },
      });
      expect(h.realtime.emitMessageStatus).toHaveBeenCalledWith('org1', {
        messageId: 'msg1', conversationId: 'conv1', status: MessageStatus.FAILED,
      });
      expect(h.operationalIncidents.record).not.toHaveBeenCalled();
    },
  );
});
