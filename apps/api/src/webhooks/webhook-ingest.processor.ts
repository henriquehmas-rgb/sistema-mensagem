import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  ChannelType,
  MessageStatus,
  MessageType,
  type Channel,
  type Prisma,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { InboundMessageService } from '../inbound/inbound-message.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type WebhookIngestJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import type {
  MetaWebhookBody,
  MetaWebhookMessage,
  MetaWebhookStatus,
  MetaWebhookValue,
} from './meta-webhook.types';

/** Ordem de progressão de status — webhook atrasado nunca regride o status. */
const STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 99, // terminal
};

const META_STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

/**
 * Processor `webhook-ingest` (CONTRACTS §4 / ARCHITECTURE fluxo entrante):
 * dedupe por wamid → resolve Channel (phone_number_id) → Contact/Conversation
 * (via InboundMessageService) → Message INBOUND → eventos realtime → ai-reply.
 * Statuses (sent/delivered/read/failed) atualizam a Message OUTBOUND pelo wamid
 * e emitem message:status. Cada evento processado vira uma linha de
 * WebhookEventLog (dedupe por externalEventId).
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId resolvido.
 */
@Processor(QUEUES.WEBHOOK_INGEST)
export class WebhookIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly inbound: InboundMessageService,
  ) {
    super();
  }

  async process(job: Job<WebhookIngestJob>): Promise<void> {
    if (job.data.source !== 'meta') {
      // Webchat entra síncrono pelo WebchatService — nada a fazer aqui hoje.
      this.logger.warn(`webhook-ingest com source desconhecido: ${job.data.source} — descartado`);
      return;
    }

    const body = job.data.body as MetaWebhookBody;
    if (body.object !== 'whatsapp_business_account') {
      // Instagram Direct chega com object 'instagram' (formato Messenger) — fora do
      // escopo atual (ver ARCHITECTURE "Limitações conhecidas"). Registrado, não perdido.
      await this.logEvent(null, `object:${body.object ?? 'desconhecido'}`, body, 'ignored');
      return;
    }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value) {
          continue;
        }
        await this.processValue(change.value);
      }
    }
  }

  private async processValue(value: MetaWebhookValue): Promise<void> {
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) {
      await this.logEvent(null, null, value, 'ignored');
      return;
    }

    // Roteia pela credencial pública do canal: externalId = phone_number_id.
    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { type: ChannelType.WHATSAPP, externalId: phoneNumberId },
    });
    if (!channel) {
      this.logger.warn(`Webhook Meta para phone_number_id sem canal: ${phoneNumberId}`);
      await this.logEvent(null, `phone_number_id:${phoneNumberId}`, value, 'ignored');
      return;
    }

    for (const message of value.messages ?? []) {
      await this.processInboundMessage(channel, value, message);
    }
    for (const status of value.statuses ?? []) {
      await this.processStatus(channel, status);
    }
  }

  private async processInboundMessage(
    channel: Channel,
    value: MetaWebhookValue,
    message: MetaWebhookMessage,
  ): Promise<void> {
    const wamid = message.id;
    const from = message.from;
    if (!wamid || !from) {
      await this.logEvent(channel.orgId, wamid ?? null, message, 'ignored');
      return;
    }
    if (await this.alreadyProcessed(wamid)) {
      return;
    }

    try {
      const profileName = value.contacts?.find((c) => c.wa_id === from)?.profile?.name;
      const { type, content } = this.mapContent(message);

      const result = await this.inbound.ingest({
        orgId: channel.orgId,
        channelId: channel.id,
        channelType: ChannelType.WHATSAPP,
        externalContactId: from,
        contactName: profileName,
        contactPhone: `+${from}`,
        externalMessageId: wamid,
        type,
        content,
      });

      await this.logEvent(
        channel.orgId,
        wamid,
        message,
        result.duplicate ? 'duplicate' : 'processed',
      );
    } catch (error) {
      await this.logEvent(channel.orgId, wamid, message, 'failed');
      throw error; // BullMQ retry (attempts 3, backoff exponencial)
    }
  }

  /** sent/delivered/read/failed de mensagens OUTBOUND — nunca regride status. */
  private async processStatus(channel: Channel, status: MetaWebhookStatus): Promise<void> {
    const wamid = status.id;
    const mapped = status.status ? META_STATUS_MAP[status.status] : undefined;
    if (!wamid || !mapped) {
      return;
    }
    const eventId = `${wamid}:${status.status ?? '?'}`;
    if (await this.alreadyProcessed(eventId)) {
      return;
    }

    const message = await this.prisma.prismaSystem.message.findFirst({
      where: { orgId: channel.orgId, externalId: wamid },
      select: { id: true, conversationId: true, status: true },
    });
    if (!message) {
      await this.logEvent(channel.orgId, eventId, status, 'ignored');
      return;
    }

    if (STATUS_RANK[mapped] > STATUS_RANK[message.status]) {
      const errorMessage =
        mapped === MessageStatus.FAILED
          ? (status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? 'Falha reportada pela Meta')
          : undefined;
      await this.prisma.prismaSystem.message.update({
        where: { id: message.id },
        data: { status: mapped, ...(errorMessage ? { errorMessage } : {}) },
      });
      this.realtime.emitMessageStatus(channel.orgId, {
        messageId: message.id,
        conversationId: message.conversationId,
        status: mapped,
      });
    }
    await this.logEvent(channel.orgId, eventId, status, 'processed');
  }

  /** Mapeia o corpo Meta → MessageType/content do CONTRACTS §3. */
  private mapContent(message: MetaWebhookMessage): {
    type: MessageType;
    content: Record<string, unknown>;
  } {
    switch (message.type) {
      case 'text':
        return { type: MessageType.TEXT, content: { text: message.text?.body ?? '' } };
      case 'image':
      case 'audio':
      case 'video':
      case 'sticker':
      case 'document': {
        const media = message[message.type];
        const typeMap = {
          image: MessageType.IMAGE,
          audio: MessageType.AUDIO,
          video: MessageType.VIDEO,
          sticker: MessageType.STICKER,
          document: MessageType.DOCUMENT,
        } as const;
        return {
          type: typeMap[message.type],
          content: {
            // A URL da mídia Meta expira em minutos e exige download autenticado —
            // armazenamos o media id; resolução/re-host é limitação conhecida (docs).
            mediaId: media?.id ?? null,
            mimeType: media?.mime_type ?? null,
            ...(media?.caption ? { caption: media.caption } : {}),
            ...(message.type === 'document' && message.document?.filename
              ? { filename: message.document.filename }
              : {}),
          },
        };
      }
      case 'location':
        return {
          type: MessageType.LOCATION,
          content: {
            latitude: message.location?.latitude ?? null,
            longitude: message.location?.longitude ?? null,
            ...(message.location?.name ? { name: message.location.name } : {}),
            ...(message.location?.address ? { address: message.location.address } : {}),
          },
        };
      case 'button':
        return { type: MessageType.TEXT, content: { text: message.button?.text ?? '[botão]' } };
      case 'interactive': {
        const reply =
          message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
        return { type: MessageType.TEXT, content: { text: reply ?? '[interativo]' } };
      }
      default:
        return {
          type: MessageType.TEXT,
          content: { text: `[tipo não suportado: ${message.type ?? 'desconhecido'}]` },
        };
    }
  }

  private async alreadyProcessed(externalEventId: string): Promise<boolean> {
    const log = await this.prisma.prismaSystem.webhookEventLog.findFirst({
      where: {
        source: 'meta',
        externalEventId,
        status: { in: ['processed', 'duplicate', 'ignored'] },
      },
      select: { id: true },
    });
    return log !== null;
  }

  private async logEvent(
    orgId: string | null,
    externalEventId: string | null,
    payload: unknown,
    status: 'processed' | 'duplicate' | 'ignored' | 'failed',
  ): Promise<void> {
    try {
      await this.prisma.prismaSystem.webhookEventLog.create({
        data: {
          orgId,
          source: 'meta',
          externalEventId,
          payload: payload as Prisma.InputJsonValue,
          status,
        },
      });
    } catch (error) {
      // log de evento é best-effort — nunca derruba o processamento
      this.logger.warn(`Falha ao gravar WebhookEventLog: ${(error as Error).message}`);
    }
  }
}
