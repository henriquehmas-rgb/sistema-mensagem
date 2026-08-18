import 'reflect-metadata';
import { ChannelType, MessageStatus, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookIngestJob } from '../queues/queues.constants';
import { WebhookIngestProcessor } from './webhook-ingest.processor';

/**
 * Testes do roteamento Instagram do processor `webhook-ingest` com mocks
 * hand-rolled de PrismaService/RealtimeService/InboundMessageService/
 * MetaGraphService (não há padrão de mock de prisma no repo — os specs
 * existentes testam funções puras; aqui o processor é instanciado direto).
 */

const IG_BUSINESS_ID = '17841400000000001';
const IG_USER_ID = '1234567890000001';
const MID = 'aWdfZGlyZWN0Om1pZC0wMDE';
const ORG_ID = 'org_seeg';

const channelRow = {
  id: 'ch_ig',
  orgId: ORG_ID,
  type: ChannelType.INSTAGRAM,
  externalId: IG_BUSINESS_ID,
  encryptedCredentials: 'enc',
};

function igBody(messaging: unknown[], entryId: string = IG_BUSINESS_ID): unknown {
  return { object: 'instagram', entry: [{ id: entryId, time: 1755500000, messaging }] };
}

function jobOf(body: unknown): Job<WebhookIngestJob> {
  return {
    data: { source: 'meta', body, headers: {}, receivedAt: new Date().toISOString() },
  } as Job<WebhookIngestJob>;
}

function createHarness() {
  const prismaSystem = {
    channel: { findFirst: vi.fn().mockResolvedValue(channelRow) },
    contactIdentity: { findUnique: vi.fn().mockResolvedValue(null) },
    message: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    webhookEventLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const realtime = { emitMessageStatus: vi.fn() };
  const inbound = {
    ingest: vi
      .fn()
      .mockResolvedValue({ duplicate: false, messageId: 'msg1', conversationId: 'conv1' }),
  };
  const metaGraph = {
    decryptCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
    fetchInstagramProfile: vi
      .fn()
      .mockResolvedValue({ name: 'Maria do IG', profilePicUrl: 'https://cdn/pic.jpg' }),
  };
  const media = { fetchAndStore: vi.fn() };
  const webhookIngestQueue = { add: vi.fn() };
  const processor = new WebhookIngestProcessor(
    { prismaSystem } as never,
    realtime as never,
    inbound as never,
    metaGraph as never,
    media as never,
    webhookIngestQueue as never,
  );
  return { prismaSystem, realtime, inbound, metaGraph, media, webhookIngestQueue, processor };
}

describe('WebhookIngestProcessor — Instagram Direct', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('texto inbound → resolve canal por recipient.id e ingere com identidade IG', async () => {
    const body = igBody([
      {
        sender: { id: IG_USER_ID },
        recipient: { id: IG_BUSINESS_ID },
        timestamp: 1755500000000,
        message: { mid: MID, text: 'Oi!' },
      },
    ]);
    await harness.processor.process(jobOf(body));

    expect(harness.prismaSystem.channel.findFirst).toHaveBeenCalledWith({
      where: { type: ChannelType.INSTAGRAM, externalId: IG_BUSINESS_ID },
    });
    expect(harness.metaGraph.fetchInstagramProfile).toHaveBeenCalledWith(
      { accessToken: 'token' },
      IG_USER_ID,
    );
    expect(harness.inbound.ingest).toHaveBeenCalledExactlyOnceWith({
      orgId: ORG_ID,
      channelId: 'ch_ig',
      channelType: ChannelType.INSTAGRAM,
      externalContactId: IG_USER_ID,
      contactName: 'Maria do IG',
      contactAvatarUrl: 'https://cdn/pic.jpg',
      externalMessageId: MID,
      type: MessageType.TEXT,
      content: { text: 'Oi!' },
    });
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: ORG_ID, externalEventId: MID, status: 'processed' }),
      }),
    );
  });

  it('perfil IG indisponível → fallback "Instagram User" (best-effort)', async () => {
    harness.metaGraph.fetchInstagramProfile.mockResolvedValue(null);
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            message: { mid: MID, text: 'Oi!' },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ contactName: 'Instagram User' }),
    );
  });

  it('anexo de mídia → mensagem com mediaUrl do CDN da Meta', async () => {
    const url = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=abc';
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            message: { mid: MID, attachments: [{ type: 'audio', payload: { url } }] },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: MessageType.AUDIO,
        content: { mediaUrl: url, mimeType: null },
        externalMessageId: MID,
      }),
    );
  });

  it('echo do business é ignorado sem ingestão', async () => {
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_BUSINESS_ID },
            recipient: { id: IG_USER_ID },
            message: { mid: MID, text: 'resposta nossa', is_echo: true },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).not.toHaveBeenCalled();
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: MID, status: 'ignored' }),
      }),
    );
  });

  it('dedupe por mid: evento já registrado no WebhookEventLog não reprocessa', async () => {
    harness.prismaSystem.webhookEventLog.findFirst.mockResolvedValue({ id: 'log1' });
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            message: { mid: MID, text: 'Oi!' },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).not.toHaveBeenCalled();
    expect(harness.prismaSystem.webhookEventLog.create).not.toHaveBeenCalled();
  });

  it('dedupe fino: ingest devolvendo duplicate → log "duplicate"', async () => {
    harness.inbound.ingest.mockResolvedValue({
      duplicate: true,
      messageId: 'msg1',
      conversationId: 'conv1',
    });
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            message: { mid: MID, text: 'Oi!' },
          },
        ]),
      ),
    );
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'duplicate' }) }),
    );
  });

  it('canal INSTAGRAM inexistente → log "ignored" sem ingestão', async () => {
    harness.prismaSystem.channel.findFirst.mockResolvedValue(null);
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: '999_sem_canal' },
            message: { mid: MID, text: 'Oi!' },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).not.toHaveBeenCalled();
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ignored' }) }),
    );
  });

  it('read → OUTBOUND anteriores SENT/DELIVERED viram READ + message:status', async () => {
    const anchor = { id: 'msg_out2', conversationId: 'conv1', createdAt: new Date('2026-08-18') };
    harness.prismaSystem.message.findFirst.mockResolvedValue(anchor);
    harness.prismaSystem.message.findMany.mockResolvedValue([{ id: 'msg_out1' }, { id: 'msg_out2' }]);

    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            read: { mid: MID },
          },
        ]),
      ),
    );

    expect(harness.prismaSystem.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG_ID, externalId: MID } }),
    );
    expect(harness.prismaSystem.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['msg_out1', 'msg_out2'] } },
      data: { status: MessageStatus.READ },
    });
    expect(harness.realtime.emitMessageStatus).toHaveBeenCalledTimes(2);
    expect(harness.realtime.emitMessageStatus).toHaveBeenCalledWith(ORG_ID, {
      messageId: 'msg_out1',
      conversationId: 'conv1',
      status: MessageStatus.READ,
    });
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: `${MID}:read`, status: 'processed' }),
      }),
    );
  });

  it('read com mid desconhecido → log "orphaned" (não-terminal) e nada emitido', async () => {
    await harness.processor.process(
      jobOf(
        igBody([
          { sender: { id: IG_USER_ID }, recipient: { id: IG_BUSINESS_ID }, read: { mid: MID } },
        ]),
      ),
    );
    expect(harness.prismaSystem.message.updateMany).not.toHaveBeenCalled();
    expect(harness.realtime.emitMessageStatus).not.toHaveBeenCalled();
    // 'orphaned' fica FORA de alreadyProcessed: o read pode ter chegado antes
    // de o wamid/mid persistir — a reentrega da Meta reprocessa.
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: `${MID}:read`, status: 'orphaned' }),
      }),
    );
  });

  it('múltiplos anexos → um Message por anexo com externalId sufixado', async () => {
    const url = (n: string) => `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=${n}`;
    await harness.processor.process(
      jobOf(
        igBody([
          {
            sender: { id: IG_USER_ID },
            recipient: { id: IG_BUSINESS_ID },
            message: {
              mid: MID,
              attachments: [
                { type: 'image', payload: { url: url('a') } },
                { type: 'video', payload: { url: url('b') } },
              ],
            },
          },
        ]),
      ),
    );
    expect(harness.inbound.ingest).toHaveBeenCalledTimes(2);
    expect(harness.inbound.ingest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ externalMessageId: MID, type: MessageType.IMAGE }),
    );
    expect(harness.inbound.ingest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ externalMessageId: `${MID}:1`, type: MessageType.VIDEO }),
    );
  });
});
