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

function buildService(overrides: { media?: Partial<MediaService>; inbound?: Partial<InboundMessageService>; prisma?: Partial<PrismaService> } = {}) {
  const jwtService = { verifyAsync: vi.fn().mockResolvedValue(TOKEN_PAYLOAD) };
  const media = { storeUpload: vi.fn(), ...overrides.media } as unknown as MediaService;
  const inbound = {
    ingestIntoConversation: vi.fn().mockResolvedValue({ messageId: 'msg-1', conversationId: 'conversation-1' }),
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
  const realtime = {} as RealtimeService;
  const automationRunQueue = { add: vi.fn() } as never;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jwtService mock não precisa da API completa
  const service = new WebchatService(prisma, jwtService as any, inbound, realtime, media, automationRunQueue);
  return { service, jwtService, media, inbound, prisma };
}

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
