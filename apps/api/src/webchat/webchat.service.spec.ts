import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { InboundMessageService } from '../inbound/inbound-message.service';
import type { MediaService, StoredUpload } from '../media/media.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { WebchatService, type WebchatTokenPayload } from './webchat.service';

/**
 * WebchatService.uploadMedia / sendMessage(mídia) — CONTRACTS §13: o visitante
 * NUNCA controla o orgId (vem só do visitorToken) e NUNCA pode referenciar uma
 * mediaUrl que não seja o próprio upload feito via POST /webchat/uploads desta
 * organização (sem aba "por URL" livre no widget).
 */

const TOKEN_PAYLOAD: WebchatTokenPayload = {
  sub: 'contact-1',
  orgId: 'org-do-token',
  channelId: 'channel-1',
  conversationId: 'conversation-1',
  scope: 'webchat',
};

// ensureConversation retorna a projeção completa usada pelo CRM. Mantemos o
// mock fiel a esse contrato para validar também o evento emitido ao abrir a
// sessão, em vez de mascarar uma relação ausente como se fosse runtime.
const CONVERSATION_WITH_RELATIONS = {
  id: 'conversation-1', protocol: 'SEEG-TEST-0001', orgId: TOKEN_PAYLOAD.orgId,
  contactId: TOKEN_PAYLOAD.sub, channelId: TOKEN_PAYLOAD.channelId, status: 'OPEN',
  assigneeId: null, stageId: null, stagePosition: 0, departmentId: null,
  resolutionReasonId: null, resolutionNote: null, resolvedAt: null,
  lastIntent: null, secondaryIntent: null, alternativeRouteKey: null,
  triageConflict: false, routingEvidence: [], triageConfidence: null,
  triagedAt: null, caseSummary: null, clarificationCount: 0,
  identityVerifiedAt: null, identityVerificationMethod: null,
  aiEnabled: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
  createdAt: new Date(), updatedAt: new Date(),
  contact: {
    id: TOKEN_PAYLOAD.sub, orgId: TOKEN_PAYLOAD.orgId, name: 'Cliente de teste',
    phone: '+5565999999999', email: null, avatarUrl: null, notes: null,
    customFields: {}, memorySummary: null, memoryUpdatedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
  assignee: null, channel: { id: TOKEN_PAYLOAD.channelId, type: 'WEBCHAT' },
  department: null, resolutionReason: null, tags: [],
};

function buildService(overrides: { media?: Partial<MediaService>; inbound?: Partial<InboundMessageService>; prisma?: Partial<PrismaService> } = {}) {
  const jwtService = {
    verifyAsync: vi.fn().mockResolvedValue(TOKEN_PAYLOAD),
    signAsync: vi.fn().mockResolvedValue('visitor-token'),
  };
  const media = { storeUpload: vi.fn(), ...overrides.media } as unknown as MediaService;
  const inbound = {
    ingestIntoConversation: vi.fn().mockResolvedValue({ messageId: 'msg-1', conversationId: 'conversation-1' }),
    ensureContact: vi.fn().mockResolvedValue({ id: 'contact-1' }),
    ensureConversation: vi.fn().mockResolvedValue({ conversation: CONVERSATION_WITH_RELATIONS, created: true }),
    ...overrides.inbound,
  } as unknown as InboundMessageService;
  const prisma = {
    prismaSystem: {
      message: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'msg-1',
          orgId: TOKEN_PAYLOAD.orgId,
          conversationId: TOKEN_PAYLOAD.conversationId,
          direction: 'INBOUND',
          type: MessageType.IMAGE,
          content: {},
          status: 'DELIVERED',
          authorId: null,
          isAiGenerated: false,
          errorMessage: null,
          createdAt: new Date(),
          author: null,
        }),
      },
    },
    ...overrides.prisma,
  } as unknown as PrismaService;
  const realtime = { emitConversationNew: vi.fn() } as unknown as RealtimeService;
  const automationRunQueue = { add: vi.fn() } as never;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jwtService mock não precisa da API completa
  const service = new WebchatService(prisma, jwtService as any, inbound, realtime, media, automationRunQueue);
  return { service, jwtService, media, inbound, prisma };
}

describe('WebchatService.createSession — contato identificado', () => {
  it('vincula a sessão web ao telefone informado, em vez de criar visitante anônimo', async () => {
    const organization = { id: 'org-1', name: 'SEEG' };
    const channel = { id: 'channel-1' };
    const { service, inbound } = buildService({
      prisma: {
        prismaSystem: {
          organization: { findUnique: vi.fn().mockResolvedValue(organization) },
          channel: { findFirst: vi.fn().mockResolvedValue(channel) },
        },
      } as unknown as Partial<PrismaService>,
    });

    await expect(service.createSession({
      orgSlug: 'seeg', name: 'Cliente de teste', phone: '+5565999999999',
    })).resolves.toMatchObject({ conversationId: 'conversation-1', visitorToken: 'visitor-token' });

    expect(inbound.ensureContact).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', channelType: 'WEBCHAT', contactName: 'Cliente de teste', contactPhone: '+5565999999999',
    }));
  });
});

describe('WebchatService.uploadMedia — tenant scoping', () => {
  it('grava com o orgId do visitorToken, nunca com um valor do request', async () => {
    const stored: StoredUpload = {
      mediaUrl: `/api/media/${TOKEN_PAYLOAD.orgId}/uploads/abc.jpg`,
      mimeType: 'image/jpeg',
      filename: 'foto.jpg',
      sizeBytes: 4,
    };
    const { service, media } = buildService({ media: { storeUpload: vi.fn().mockResolvedValue(stored) } });

    const file = { buffer: Buffer.from([1]), mimetype: 'image/jpeg', size: 1 };
    const result = await service.uploadMedia('valid-token', file);

    expect(media.storeUpload).toHaveBeenCalledExactlyOnceWith(TOKEN_PAYLOAD.orgId, file);
    expect(result).toBe(stored);
  });

  it('sem arquivo → 400, sem chamar o storage', async () => {
    const { service, media } = buildService();
    await expect(service.uploadMedia('valid-token', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(media.storeUpload).not.toHaveBeenCalled();
  });
});

describe('WebchatService.sendMessage — mediaUrl restrita ao próprio upload da org', () => {
  it('rejeita mediaUrl fora do prefixo /api/media/{orgId}/uploads/ (sem chegar a ingerir)', async () => {
    const { service, inbound } = buildService();
    await expect(
      service.sendMessage('valid-token', {
        type: MessageType.IMAGE,
        mediaUrl: 'https://evil.example.com/tracker.png',
        mimeType: 'image/png',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inbound.ingestIntoConversation).not.toHaveBeenCalled();
  });

  it('rejeita mediaUrl de OUTRA organização mesmo com o formato correto', async () => {
    const { service, inbound } = buildService();
    await expect(
      service.sendMessage('valid-token', {
        type: MessageType.IMAGE,
        mediaUrl: '/api/media/outra-org/uploads/abc.jpg',
        mimeType: 'image/png',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inbound.ingestIntoConversation).not.toHaveBeenCalled();
  });

  it('aceita mediaUrl do próprio upload da org e ingere com o content correto', async () => {
    const { service, inbound } = buildService();
    await service.sendMessage('valid-token', {
      type: MessageType.IMAGE,
      mediaUrl: `/api/media/${TOKEN_PAYLOAD.orgId}/uploads/abc.jpg`,
      mimeType: 'image/jpeg',
      filename: 'foto.jpg',
    } as never);

    expect(inbound.ingestIntoConversation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        orgId: TOKEN_PAYLOAD.orgId,
        type: MessageType.IMAGE,
        content: expect.objectContaining({
          mediaUrl: `/api/media/${TOKEN_PAYLOAD.orgId}/uploads/abc.jpg`,
          mimeType: 'image/jpeg',
          filename: 'foto.jpg',
        }),
      }),
    );
  });

  it('type TEXT sem texto não vazio → 400', async () => {
    const { service } = buildService();
    await expect(
      service.sendMessage('valid-token', { type: MessageType.TEXT, text: '   ' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
