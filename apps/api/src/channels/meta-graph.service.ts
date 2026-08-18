import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, type Channel } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { CryptoService } from '../crypto/crypto.service';

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** Credenciais de canal Meta após decrypt (chaves livres; estas são as usadas). */
export interface MetaChannelCredentials {
  accessToken?: string;
  phoneNumberId?: string;
  [key: string]: unknown;
}

export interface GraphSendResult {
  externalId: string; // wamid
}

/**
 * Erro de negócio da Graph API (4xx): NÃO deve ser retentado pelo BullMQ —
 * o call site marca a mensagem como FAILED. Erros de rede/5xx são lançados
 * como Error comum e caem no retry com backoff.
 */
export class GraphPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphPermanentError';
  }
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number };
}

/**
 * Cliente da Meta Graph API (WhatsApp Cloud API).
 * - Credenciais SEMPRE via decrypt de Channel.encryptedCredentials (AES-256-GCM);
 *   tokens nunca são logados (CONTRACTS §9).
 * - `testChannel`: GET /{phone_number_id} — valida token + id (POST /channels/:id/test).
 * - `sendWhatsAppMessage`: POST /{phone_number_id}/messages — retorna o wamid.
 */
@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);
  private readonly graphVersion: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly crypto: CryptoService,
  ) {
    this.graphVersion = config.get('META_GRAPH_VERSION', { infer: true });
  }

  /** Decripta e parseia as credenciais do canal; null se ausentes/corrompidas. */
  decryptCredentials(channel: Pick<Channel, 'encryptedCredentials'>): MetaChannelCredentials | null {
    if (!channel.encryptedCredentials) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(this.crypto.decrypt(channel.encryptedCredentials));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as MetaChannelCredentials;
    } catch {
      // Chave trocada ou payload corrompido — nunca logar o conteúdo.
      this.logger.warn('Credenciais de canal indecifráveis (APP_ENCRYPTION_KEY trocada?)');
      return null;
    }
  }

  /** Valida credenciais contra a Graph API. Lança Error com motivo em falha. */
  async testChannel(credentials: MetaChannelCredentials): Promise<void> {
    const { accessToken, phoneNumberId } = this.requireCredentials(credentials);
    const response = await this.graphFetch(
      `/${phoneNumberId}?fields=id`,
      accessToken,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(await this.describeGraphError(response));
    }
  }

  /**
   * Envia uma mensagem OUTBOUND via WhatsApp Cloud API.
   * Suporta TEXT, mídia por link (IMAGE/AUDIO/VIDEO/DOCUMENT/STICKER), LOCATION
   * e TEMPLATE ({templateName, params}). Tipos sem mapeamento → GraphPermanentError.
   */
  async sendWhatsAppMessage(
    credentials: MetaChannelCredentials,
    to: string,
    type: MessageType,
    content: Record<string, unknown>,
  ): Promise<GraphSendResult> {
    const { accessToken, phoneNumberId } = this.requireCredentials(credentials);
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...this.buildMessagePayload(type, content),
    };

    const response = await this.graphFetch(`/${phoneNumberId}/messages`, accessToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const description = await this.describeGraphError(response);
      // 4xx = payload/credencial inválidos (permanente); 5xx = transiente (retry).
      if (response.status >= 400 && response.status < 500) {
        throw new GraphPermanentError(description);
      }
      throw new Error(description);
    }

    const body = (await response.json()) as { messages?: Array<{ id?: string }> };
    const externalId = body.messages?.[0]?.id;
    if (!externalId) {
      throw new Error('Graph API não retornou wamid na resposta de envio');
    }
    return { externalId };
  }

  private buildMessagePayload(
    type: MessageType,
    content: Record<string, unknown>,
  ): Record<string, unknown> {
    const text = typeof content.text === 'string' ? content.text : '';
    const mediaUrl = typeof content.mediaUrl === 'string' ? content.mediaUrl : '';
    const caption = typeof content.caption === 'string' ? content.caption : undefined;

    switch (type) {
      case MessageType.TEXT:
        return { type: 'text', text: { body: text } };
      case MessageType.IMAGE:
        return { type: 'image', image: { link: mediaUrl, ...(caption ? { caption } : {}) } };
      case MessageType.AUDIO:
        return { type: 'audio', audio: { link: mediaUrl } };
      case MessageType.VIDEO:
        return { type: 'video', video: { link: mediaUrl, ...(caption ? { caption } : {}) } };
      case MessageType.DOCUMENT:
        return {
          type: 'document',
          document: {
            link: mediaUrl,
            ...(typeof content.filename === 'string' ? { filename: content.filename } : {}),
          },
        };
      case MessageType.STICKER:
        return { type: 'sticker', sticker: { link: mediaUrl } };
      case MessageType.LOCATION:
        return {
          type: 'location',
          location: { latitude: content.latitude, longitude: content.longitude },
        };
      case MessageType.TEMPLATE: {
        const params = Array.isArray(content.params) ? content.params : [];
        return {
          type: 'template',
          template: {
            name: typeof content.templateName === 'string' ? content.templateName : '',
            language: {
              code: typeof content.languageCode === 'string' ? content.languageCode : 'pt_BR',
            },
            ...(params.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: params.map((param) => ({ type: 'text', text: String(param) })),
                    },
                  ],
                }
              : {}),
          },
        };
      }
      case MessageType.SYSTEM:
        throw new GraphPermanentError('Mensagens SYSTEM não são entregues a canais');
      default:
        throw new GraphPermanentError(`Tipo de mensagem sem mapeamento Graph API: ${type}`);
    }
  }

  private requireCredentials(credentials: MetaChannelCredentials): {
    accessToken: string;
    phoneNumberId: string;
  } {
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
    const phoneNumberId =
      typeof credentials.phoneNumberId === 'string' ? credentials.phoneNumberId : '';
    if (!accessToken || !phoneNumberId) {
      throw new GraphPermanentError(
        'Credenciais incompletas: accessToken e phoneNumberId são obrigatórios',
      );
    }
    return { accessToken, phoneNumberId };
  }

  private graphFetch(path: string, accessToken: string, init: RequestInit): Promise<Response> {
    return fetch(`${GRAPH_BASE_URL}/${this.graphVersion}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async describeGraphError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as GraphErrorBody;
      const message = body.error?.message ?? 'erro desconhecido';
      const code = body.error?.code;
      return `Graph API ${response.status}${code ? ` (code ${code})` : ''}: ${message}`;
    } catch {
      return `Graph API ${response.status}: resposta não-JSON`;
    }
  }
}
