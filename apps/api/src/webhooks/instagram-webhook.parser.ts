import { MessageType } from '@prisma/client';

/**
 * Formas relevantes + parsing PURO do payload de webhook do Instagram Direct
 * (object 'instagram', formato Messenger: entry[].messaging[]).
 * Campos não mapeados são ignorados — o payload cru fica em WebhookEventLog.
 * Funções puras (sem IO) para permitir testes unitários sem mocks de banco.
 */

export interface InstagramWebhookBody {
  object?: string; // 'instagram'
  entry?: InstagramWebhookEntry[];
}

export interface InstagramWebhookEntry {
  id?: string; // ig business id (mesmo valor de recipient.id nos eventos inbound)
  time?: number;
  messaging?: InstagramMessagingEvent[];
}

export interface InstagramMessagingEvent {
  sender?: { id?: string }; // ig-scoped user id (IGSID) — ou o business, em echo
  recipient?: { id?: string }; // ig business id nos eventos inbound
  timestamp?: number;
  message?: InstagramMessage;
  read?: { mid?: string }; // recibo de leitura: mid da ÚLTIMA mensagem lida
}

export interface InstagramMessage {
  mid?: string; // dedupe — mesmo papel do wamid no WhatsApp
  text?: string;
  is_echo?: boolean; // mensagem enviada PELO business (inclusive por esta api)
  attachments?: InstagramAttachment[];
}

export interface InstagramAttachment {
  type?: string; // image | video | audio | file | share | story_mention | ...
  payload?: { url?: string };
}

/** Um item persistível de mensagem (um por anexo; ou um único TEXT). */
export interface InstagramContentItem {
  type: MessageType;
  content: Record<string, unknown>;
}

export type ParsedInstagramEvent =
  | {
      kind: 'message';
      /** recipient.id — roteia o Channel INSTAGRAM por externalId. */
      igBusinessId: string;
      senderId: string;
      mid: string;
      items: InstagramContentItem[];
    }
  | { kind: 'read'; igBusinessId: string; senderId: string; lastReadMid: string }
  | {
      kind: 'ignored';
      reason: 'echo' | 'self' | 'malformed' | 'unsupported';
      mid: string | null;
    };

/**
 * URLs de mídia do CDN da Meta para IG duram mais que as do WhatsApp — aqui a
 * própria URL vai para content.mediaUrl (sem re-host; mimeType não vem no payload).
 */
const ATTACHMENT_TYPE_MAP: Readonly<Partial<Record<string, MessageType>>> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  file: MessageType.DOCUMENT,
  story_mention: MessageType.IMAGE, // menção em story chega como mídia (imagem/vídeo do story)
};

/** externalId da Message: mid puro no 1º item; sufixo por índice nos demais anexos. */
export function instagramExternalMessageId(mid: string, index: number): string {
  return index === 0 ? mid : `${mid}:${index}`;
}

/**
 * Classifica um evento messaging[] do IG: mensagem inbound, recibo de leitura,
 * ou ignorado (echo do business, malformado, sem conteúdo suportado).
 */
export function parseInstagramMessagingEvent(
  entry: Pick<InstagramWebhookEntry, 'id'>,
  event: InstagramMessagingEvent,
): ParsedInstagramEvent {
  const igBusinessId = event.recipient?.id ?? '';
  const senderId = event.sender?.id ?? '';

  if (event.read) {
    const mid = event.read.mid ?? '';
    if (!igBusinessId || !senderId || !mid) {
      return { kind: 'ignored', reason: 'malformed', mid: mid || null };
    }
    return { kind: 'read', igBusinessId, senderId, lastReadMid: mid };
  }

  const message = event.message;
  if (!message) {
    // postbacks/reactions/optins etc. — sem mapeamento hoje
    return { kind: 'ignored', reason: 'unsupported', mid: null };
  }

  const mid = message.mid ?? null;
  // Echo = mensagem enviada pelo próprio business (inclusive as desta api);
  // sender.id igual ao ig business id (entry.id) cobre payloads sem is_echo.
  if (message.is_echo === true) {
    return { kind: 'ignored', reason: 'echo', mid };
  }
  if (senderId && (senderId === entry.id || senderId === igBusinessId)) {
    return { kind: 'ignored', reason: 'self', mid };
  }
  if (!igBusinessId || !senderId || !mid) {
    return { kind: 'ignored', reason: 'malformed', mid };
  }

  const items = mapInstagramContent(message);
  if (items.length === 0) {
    return { kind: 'ignored', reason: 'unsupported', mid };
  }
  return { kind: 'message', igBusinessId, senderId, mid, items };
}

/**
 * Mapeia o corpo IG → MessageType/content do CONTRACTS §3.
 * Texto puro → um TEXT; com anexos → um item por anexo (texto vira caption do 1º).
 */
export function mapInstagramContent(message: InstagramMessage): InstagramContentItem[] {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const attachments = message.attachments ?? [];

  if (attachments.length === 0) {
    return text ? [{ type: MessageType.TEXT, content: { text } }] : [];
  }
  return attachments.map((attachment, index) =>
    mapInstagramAttachment(attachment, index === 0 ? text : ''),
  );
}

function mapInstagramAttachment(
  attachment: InstagramAttachment,
  caption: string,
): InstagramContentItem {
  const mediaUrl = typeof attachment.payload?.url === 'string' ? attachment.payload.url : '';
  const mapped = attachment.type ? ATTACHMENT_TYPE_MAP[attachment.type] : undefined;

  if (mapped && mediaUrl) {
    return {
      type: mapped,
      content: {
        mediaUrl,
        mimeType: null, // IG não informa mime type no webhook
        ...(caption ? { caption } : {}),
      },
    };
  }
  // share e tipos desconhecidos: preserva o link como texto (padrão de
  // placeholder do WhatsApp para tipos sem mapeamento).
  if (mediaUrl) {
    const label = `[${attachment.type ?? 'anexo'}] ${mediaUrl}`;
    return {
      type: MessageType.TEXT,
      content: { text: caption ? `${caption}\n${label}` : label },
    };
  }
  return {
    type: MessageType.TEXT,
    content: {
      text: caption || `[anexo não suportado: ${attachment.type ?? 'desconhecido'}]`,
    },
  };
}
