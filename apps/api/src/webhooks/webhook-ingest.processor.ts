import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  ChannelType,
  MessageDirection,
  MessageStatus,
  MessageType,
  type Channel,
  type Prisma,
} from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { MetaGraphService } from '../channels/meta-graph.service';
import { messageInclude, toMessageDto } from '../common/serializers';
import { InboundMessageService } from '../inbound/inbound-message.service';
import { MediaService, type StoredMedia } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MEDIA_FETCH_JOB,
  QUEUES,
  type MediaFetchJob,
  type WebhookIngestJob,
} from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import {
  instagramExternalMessageId,
  parseInstagramMessagingEvent,
  type InstagramMessagingEvent,
  type InstagramWebhookBody,
  type InstagramWebhookEntry,
  type ParsedInstagramEvent,
} from './instagram-webhook.parser';
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

/** Fallback quando o perfil IG não pode ser buscado (token sem permissão etc.). */
const INSTAGRAM_FALLBACK_NAME = 'Instagram User';

/** Re-host inline de mídia: timeout CURTO para não segurar o worker da fila. */
const INLINE_MEDIA_FETCH_TIMEOUT_MS = 8_000;
/** Delay do job 'media-fetch' quando o re-host inline falha. */
const MEDIA_FETCH_RETRY_DELAY_MS = 30_000;

/**
 * Processor `webhook-ingest` (CONTRACTS §4 / ARCHITECTURE fluxo entrante):
 * - WhatsApp (object 'whatsapp_business_account'): dedupe por wamid → resolve
 *   Channel (phone_number_id) → Contact/Conversation (via InboundMessageService)
 *   → Message INBOUND → eventos realtime → ai-reply. Statuses
 *   (sent/delivered/read/failed) atualizam a Message OUTBOUND pelo wamid e
 *   emitem message:status.
 * - Instagram Direct (object 'instagram', formato Messenger entry[].messaging[]):
 *   mesmo pipeline — dedupe por mid, Channel INSTAGRAM por externalId ==
 *   recipient.id (ig business id), echoes ignorados, nome via Graph API
 *   (best-effort) e recibos read → READ nas OUTBOUND anteriores.
 * - Mídia WhatsApp: re-host inline via MediaService (timeout curto) antes da
 *   Message; fallback content.mediaId + job 'media-fetch' (MESMA fila, delayed,
 *   3 tentativas) que completa o re-host e emite message:updated.
 * Cada evento processado vira uma linha de WebhookEventLog (dedupe por
 * externalEventId). Sem contexto de request → prismaSystem SEMPRE filtrando
 * orgId resolvido.
 */
@Processor(QUEUES.WEBHOOK_INGEST)
export class WebhookIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly inbound: InboundMessageService,
    private readonly metaGraph: MetaGraphService,
    private readonly media: MediaService,
    @InjectQueue(QUEUES.WEBHOOK_INGEST)
    private readonly webhookIngestQueue: Queue<MediaFetchJob>,
  ) {
    super();
  }

  async process(job: Job<WebhookIngestJob | MediaFetchJob>): Promise<void> {
    // Retry do re-host de mídia — job delayed na MESMA fila (CONTRACTS §4).
    if (job.name === MEDIA_FETCH_JOB) {
      try {
        await this.processMediaFetch(job.data as MediaFetchJob);
      } catch (error) {
        const attempts = job.opts.attempts ?? 1;
        if (job.attemptsMade + 1 >= attempts) {
          // Falha terminal: comunica ao agente em vez de deixar a bolha vazia.
          await this.markMediaUnavailable(job.data as MediaFetchJob);
        }
        throw error; // BullMQ decide (retry ou failed definitivo)
      }
      return;
    }

    const data = job.data as WebhookIngestJob;
    if (data.source !== 'meta') {
      // Webchat entra síncrono pelo WebchatService — nada a fazer aqui hoje.
      this.logger.warn(`webhook-ingest com source desconhecido: ${data.source} — descartado`);
      return;
    }

    const body = data.body as MetaWebhookBody;
    if (body.object === 'instagram') {
      await this.processInstagramBody(body as InstagramWebhookBody);
      return;
    }
    if (body.object !== 'whatsapp_business_account') {
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

      // Mídia: re-host INLINE (timeout curto) antes de criar a Message; se
      // falhar, a Message nasce com content.mediaId e o job 'media-fetch'
      // (delayed, mesma fila) completa o re-host e emite message:updated.
      const mediaId = typeof content.mediaId === 'string' ? content.mediaId : null;
      let finalContent = content;
      let inlineStored: StoredMedia | null = null;
      if (mediaId) {
        const rehost = await this.tryInlineMediaFetch(channel, mediaId, content);
        if (rehost) {
          finalContent = rehost.content;
          inlineStored = rehost.stored;
        }
      }

      const result = await this.inbound.ingest({
        orgId: channel.orgId,
        channelId: channel.id,
        channelType: ChannelType.WHATSAPP,
        externalContactId: from,
        contactName: profileName,
        contactPhone: `+${from}`,
        externalMessageId: wamid,
        type,
        content: finalContent,
      });

      if (result.duplicate && inlineStored) {
        // Reentrega perdeu a corrida pro unique de Message: o arquivo recém
        // re-hospedado nunca será referenciado — limpa (best-effort).
        await this.media.deleteStored(inlineStored);
      }

      if (mediaId && finalContent === content && result.messageId && !result.duplicate) {
        await this.scheduleMediaFetch(channel, result.messageId, mediaId);
      }

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
      // 'orphaned' NÃO é terminal (fora de alreadyProcessed): o status pode ter
      // chegado antes de o message-outbound persistir o wamid — reentrega reprocessa.
      await this.logEvent(channel.orgId, eventId, status, 'orphaned');
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

  // ====================== Mídia WhatsApp (re-host) ======================

  /** Tenta o re-host inline; falha vira log (o retry fica com 'media-fetch'). */
  private async tryInlineMediaFetch(
    channel: Channel,
    mediaId: string,
    content: Record<string, unknown>,
  ): Promise<{ content: Record<string, unknown>; stored: StoredMedia } | null> {
    const credentials = this.metaGraph.decryptCredentials(channel);
    if (!credentials) {
      return null;
    }
    try {
      const stored = await this.media.fetchAndStore(channel.orgId, mediaId, credentials, {
        timeoutMs: INLINE_MEDIA_FETCH_TIMEOUT_MS,
      });
      return { content: rehostedContent(content, stored), stored };
    } catch (error) {
      this.logger.warn(
        `Re-host inline de mídia falhou (media=${mediaId}): ${(error as Error).message} — retry via 'media-fetch'`,
      );
      return null;
    }
  }

  /** Agenda o retry: job 'media-fetch' delayed na MESMA fila, até 3 tentativas. */
  private async scheduleMediaFetch(
    channel: Channel,
    messageId: string,
    mediaId: string,
  ): Promise<void> {
    await this.webhookIngestQueue.add(
      MEDIA_FETCH_JOB,
      { orgId: channel.orgId, channelId: channel.id, messageId, mediaId },
      {
        delay: MEDIA_FETCH_RETRY_DELAY_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 15_000 },
      },
    );
  }

  /**
   * Job 'media-fetch': baixa a mídia da Meta, troca content.mediaId por
   * mediaUrl e emite `message:updated` (payload completo serializado).
   * Idempotente — mensagem já re-hospedada/inexistente é ignorada; falha do
   * download lança → BullMQ retenta (attempts 3, backoff exponencial).
   */
  private async processMediaFetch(data: MediaFetchJob): Promise<void> {
    const message = await this.prisma.prismaSystem.message.findFirst({
      where: { id: data.messageId, orgId: data.orgId },
      include: messageInclude,
    });
    if (!message) {
      return;
    }
    const content = asContentRecord(message.content);
    if (typeof content.mediaUrl === 'string') {
      return; // já re-hospedada (corrida inline × retry)
    }

    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { id: data.channelId, orgId: data.orgId },
    });
    const credentials = channel ? this.metaGraph.decryptCredentials(channel) : null;
    if (!credentials) {
      this.logger.warn(
        `media-fetch sem canal/credenciais (message=${data.messageId}) — descartado`,
      );
      return;
    }

    const stored = await this.media.fetchAndStore(data.orgId, data.mediaId, credentials);
    const updated = await this.prisma.prismaSystem.message.update({
      where: { id: message.id },
      data: { content: rehostedContent(content, stored) as Prisma.InputJsonValue },
      include: messageInclude,
    });
    this.realtime.emitMessageUpdated(data.orgId, { message: toMessageDto(updated) });
  }

  /**
   * Falha terminal do 'media-fetch' (3 tentativas esgotadas): marca a Message
   * com errorMessage e emite message:updated — o agente vê "mídia indisponível"
   * em vez de uma bolha vazia. Best-effort: nunca lança.
   */
  private async markMediaUnavailable(data: MediaFetchJob): Promise<void> {
    try {
      const message = await this.prisma.prismaSystem.message.findFirst({
        where: { id: data.messageId, orgId: data.orgId },
        include: messageInclude,
      });
      if (!message) {
        return;
      }
      const content = asContentRecord(message.content);
      if (typeof content.mediaUrl === 'string') {
        return; // rehost concluiu numa corrida — nada a marcar
      }
      const updated = await this.prisma.prismaSystem.message.update({
        where: { id: message.id },
        data: { errorMessage: 'Mídia indisponível (download da Meta falhou)' },
        include: messageInclude,
      });
      this.realtime.emitMessageUpdated(data.orgId, { message: toMessageDto(updated) });
    } catch (error) {
      this.logger.warn(
        `markMediaUnavailable falhou (message=${data.messageId}): ${(error as Error).message}`,
      );
    }
  }

  // ====================== Instagram Direct ======================

  private async processInstagramBody(body: InstagramWebhookBody): Promise<void> {
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        await this.processInstagramEvent(entry, event);
      }
    }
  }

  private async processInstagramEvent(
    entry: InstagramWebhookEntry,
    event: InstagramMessagingEvent,
  ): Promise<void> {
    const parsed = parseInstagramMessagingEvent(entry, event);

    if (parsed.kind === 'ignored') {
      // Echoes/malformados: dedupe pelo mid (quando houver) — a Meta reentrega.
      if (parsed.mid && (await this.alreadyProcessed(parsed.mid))) {
        return;
      }
      await this.logEvent(null, parsed.mid, event, 'ignored');
      return;
    }

    // Roteia pelo ig business id do canal: externalId = recipient.id.
    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { type: ChannelType.INSTAGRAM, externalId: parsed.igBusinessId },
    });
    if (!channel) {
      this.logger.warn(`Webhook IG para ig business id sem canal: ${parsed.igBusinessId}`);
      await this.logEvent(null, `ig:${parsed.igBusinessId}`, event, 'ignored');
      return;
    }

    if (parsed.kind === 'read') {
      await this.processInstagramRead(channel, event, parsed.lastReadMid);
      return;
    }
    await this.processInstagramMessage(channel, event, parsed);
  }

  private async processInstagramMessage(
    channel: Channel,
    event: InstagramMessagingEvent,
    parsed: Extract<ParsedInstagramEvent, { kind: 'message' }>,
  ): Promise<void> {
    if (await this.alreadyProcessed(parsed.mid)) {
      return;
    }

    try {
      const profile = await this.resolveInstagramContactProfile(channel, parsed.senderId);

      // Um Message por item (texto ou anexo); externalId sufixado além do 1º —
      // o dedupe fino fica no unique(orgId, externalId) dentro do ingest().
      let anyProcessed = false;
      for (const [index, item] of parsed.items.entries()) {
        const result = await this.inbound.ingest({
          orgId: channel.orgId,
          channelId: channel.id,
          channelType: ChannelType.INSTAGRAM,
          externalContactId: parsed.senderId,
          contactName: profile.name,
          contactAvatarUrl: profile.avatarUrl,
          externalMessageId: instagramExternalMessageId(parsed.mid, index),
          type: item.type,
          content: item.content,
        });
        if (!result.duplicate) {
          anyProcessed = true;
        }
      }

      await this.logEvent(channel.orgId, parsed.mid, event, anyProcessed ? 'processed' : 'duplicate');
    } catch (error) {
      await this.logEvent(channel.orgId, parsed.mid, event, 'failed');
      throw error; // BullMQ retry (attempts 3, backoff exponencial)
    }
  }

  /**
   * Nome/avatar do usuário IG via Graph API GET /{igsid}?fields=name,profile_pic
   * com o token do canal — BEST-EFFORT com fallback 'Instagram User'. Só consulta
   * a Graph quando a identidade ainda não existe (o nome só é usado na criação).
   */
  private async resolveInstagramContactProfile(
    channel: Channel,
    senderId: string,
  ): Promise<{ name: string; avatarUrl?: string }> {
    const identity = await this.prisma.prismaSystem.contactIdentity.findUnique({
      where: {
        orgId_channelType_externalId: {
          orgId: channel.orgId,
          channelType: ChannelType.INSTAGRAM,
          externalId: senderId,
        },
      },
      select: { id: true },
    });
    if (identity) {
      return { name: INSTAGRAM_FALLBACK_NAME }; // contato já existe — nome não será usado
    }

    const credentials = this.metaGraph.decryptCredentials(channel);
    const profile = credentials
      ? await this.metaGraph.fetchInstagramProfile(credentials, senderId)
      : null;
    return {
      name: profile?.name?.trim() || INSTAGRAM_FALLBACK_NAME,
      ...(profile?.profilePicUrl ? { avatarUrl: profile.profilePicUrl } : {}),
    };
  }

  /**
   * Recibo de leitura IG: read.mid aponta a ÚLTIMA mensagem lida — todas as
   * OUTBOUND da conversa até ela (SENT/DELIVERED) viram READ + message:status,
   * como no fluxo de statuses do WhatsApp. Nunca regride status.
   */
  private async processInstagramRead(
    channel: Channel,
    event: InstagramMessagingEvent,
    lastReadMid: string,
  ): Promise<void> {
    const eventId = `${lastReadMid}:read`;
    if (await this.alreadyProcessed(eventId)) {
      return;
    }

    const anchor = await this.prisma.prismaSystem.message.findFirst({
      where: { orgId: channel.orgId, externalId: lastReadMid },
      select: { id: true, conversationId: true, createdAt: true },
    });
    if (!anchor) {
      // 'orphaned' não é terminal — read pode chegar antes do wamid persistir.
      await this.logEvent(channel.orgId, eventId, event, 'orphaned');
      return;
    }

    const toRead = await this.prisma.prismaSystem.message.findMany({
      where: {
        orgId: channel.orgId,
        conversationId: anchor.conversationId,
        direction: MessageDirection.OUTBOUND,
        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
        createdAt: { lte: anchor.createdAt },
      },
      select: { id: true },
    });
    if (toRead.length > 0) {
      await this.prisma.prismaSystem.message.updateMany({
        where: { id: { in: toRead.map((m) => m.id) } },
        data: { status: MessageStatus.READ },
      });
      for (const { id } of toRead) {
        this.realtime.emitMessageStatus(channel.orgId, {
          messageId: id,
          conversationId: anchor.conversationId,
          status: MessageStatus.READ,
        });
      }
    }
    await this.logEvent(channel.orgId, eventId, event, 'processed');
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
            // o media id é re-hospedado (inline ou job 'media-fetch') pelo MediaService.
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
    status: 'processed' | 'duplicate' | 'ignored' | 'failed' | 'orphaned',
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

// ====================== Helpers de mídia (module-level) ======================

/** content Json da Message como Record (mesma semântica do serializer). */
function asContentRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * content re-hospedado (CONTRACTS §3): remove mediaId, aplica mediaUrl público
 * e o mime detectado no download (fallback: mime do webhook); caption/filename
 * são preservados.
 */
function rehostedContent(
  content: Record<string, unknown>,
  stored: StoredMedia,
): Record<string, unknown> {
  const { mediaId: _mediaId, ...rest } = content;
  return {
    ...rest,
    mediaUrl: stored.mediaUrl,
    mimeType: stored.mimeType ?? (typeof content.mimeType === 'string' ? content.mimeType : null),
  };
}
