import 'reflect-metadata';
import { ChannelType, MessageStatus, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookIngestJob } from '../queues/queues.constants';
import { WebhookIngestProcessor } from './webhook-ingest.processor';

const ORG_ID = 'org_seeg';
const PHONE_NUMBER_ID = '112233445566';
const WAMID = 'wamid.test-001';
const FROM = '5565999999999';

const channelRow = {
  id: 'ch_whatsapp',
  orgId: ORG_ID,
  type: ChannelType.WHATSAPP,
  externalId: PHONE_NUMBER_ID,
  encryptedCredentials: 'enc',
};

function bodyOf(value: unknown): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value }] }],
  };
}

function jobOf(body: unknown): Job<WebhookIngestJob> {
  return {
    data: { source: 'meta', body, headers: {}, receivedAt: new Date().toISOString() },
  } as Job<WebhookIngestJob>;
}

function createHarness() {
  const prismaSystem = {
    channel: { findFirst: vi.fn().mockResolvedValue(channelRow) },
    message: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    webhookEventLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const realtime = { emitMessageStatus: vi.fn() };
  const inbound = {
    ingest: vi.fn().mockResolvedValue({ duplicate: false, messageId: 'msg1', conversationId: 'conv1' }),
  };
  const metaGraph = { decryptCredentials: vi.fn().mockReturnValue(null) };
  const media = { fetchAndStore: vi.fn(), deleteStored: vi.fn() };
  const queue = { add: vi.fn() };
  return {
    prismaSystem,
    realtime,
    inbound,
    processor: new WebhookIngestProcessor(
      { prismaSystem } as never,
      realtime as never,
      inbound as never,
      metaGraph as never,
      media as never,
      queue as never,
    ),
  };
}

describe('WebhookIngestProcessor — WhatsApp', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('ingere texto no canal correspondente e preserva o wamid para dedupe', async () => {
    await harness.processor.process(
      jobOf(
        bodyOf({
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: FROM, profile: { name: 'Cliente teste' } }],
          messages: [{ id: WAMID, from: FROM, type: 'text', text: { body: 'Olá' } }],
        }),
      ),
    );

    expect(harness.inbound.ingest).toHaveBeenCalledExactlyOnceWith({
      orgId: ORG_ID,
      channelId: channelRow.id,
      channelType: ChannelType.WHATSAPP,
      externalContactId: FROM,
      contactName: 'Cliente teste',
      contactPhone: `+${FROM}`,
      externalMessageId: WAMID,
      type: MessageType.TEXT,
      content: { text: 'Olá' },
    });
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ externalEventId: WAMID, status: 'processed' }) }),
    );
  });

  it('reentrega já registrada não cria uma segunda mensagem', async () => {
    harness.prismaSystem.webhookEventLog.findFirst.mockResolvedValue({ id: 'event1' });
    await harness.processor.process(
      jobOf(
        bodyOf({
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          messages: [{ id: WAMID, from: FROM, type: 'text', text: { body: 'Olá' } }],
        }),
      ),
    );

    expect(harness.inbound.ingest).not.toHaveBeenCalled();
    expect(harness.prismaSystem.webhookEventLog.create).not.toHaveBeenCalled();
  });

  it('status atrasado não regride uma mensagem já lida', async () => {
    harness.prismaSystem.message.findFirst.mockResolvedValue({
      id: 'out1',
      conversationId: 'conv1',
      status: MessageStatus.READ,
    });
    await harness.processor.process(
      jobOf(
        bodyOf({
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          statuses: [{ id: WAMID, status: 'sent' }],
        }),
      ),
    );

    expect(harness.prismaSystem.message.update).not.toHaveBeenCalled();
    expect(harness.realtime.emitMessageStatus).not.toHaveBeenCalled();
    expect(harness.prismaSystem.webhookEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalEventId: `${WAMID}:sent`, status: 'processed' }),
      }),
    );
  });
});
