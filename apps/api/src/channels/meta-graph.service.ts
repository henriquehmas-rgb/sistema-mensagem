import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, type Channel } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { CryptoService } from '../crypto/crypto.service';

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const GRAPH_HOST_PREFIX = `${GRAPH_BASE_URL}/`;
const REQUEST_TIMEOUT_MS = 10_000;
/** Teto de páginas ao seguir `paging.next` — guarda contra loop infinito (CONTRACTS §12). */
const MAX_TEMPLATE_SYNC_PAGES = 50;

/** Credenciais de canal Meta após decrypt (chaves livres; estas são as usadas). */
export interface MetaChannelCredentials {
  accessToken?: string;
  phoneNumberId?: string;
  igBusinessId?: string;
  [key: string]: unknown;
}

export interface GraphSendResult {
  externalId: string; // wamid (WhatsApp) | message_id (Instagram)
}

/** Forma crua de um item retornado por GET /{wabaId}/message_templates (CONTRACTS §12). */
export interface RawMetaTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
  id?: string;
  [key: string]: unknown;
}

/** Perfil público de um usuário IG (best-effort; campos podem faltar). */
export interface InstagramProfile {
  name: string | null;
  profilePicUrl: string | null;
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
 * Cliente da Meta Graph API (WhatsApp Cloud API + Instagram Direct).
 * - Credenciais SEMPRE via decrypt de Channel.encryptedCredentials (AES-256-GCM);
 *   tokens nunca são logados (CONTRACTS §9).
 * - `testChannel`: GET /{phone_number_id} — valida token + id (POST /channels/:id/test).
 * - `sendWhatsAppMessage`: POST /{phone_number_id}/messages — retorna o wamid.
 * - `sendInstagramMessage`: POST /{ig_business_id}/messages — retorna o message_id.
 * - `fetchInstagramProfile`: GET /{igsid}?fields=name,profile_pic — best-effort.
 */
@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);
  private readonly graphVersion: string;
  /** Host público único (web+api via Traefik, CONTRACTS §2) — resolve mediaUrl relativo. */
  private readonly publicUrl: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly crypto: CryptoService,
  ) {
    this.graphVersion = config.get('META_GRAPH_VERSION', { infer: true });
    this.publicUrl = config.get('PUBLIC_URL', { infer: true });
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
   * Sincroniza os templates de mensagem do WABA (CONTRACTS §12):
   * GET /{wabaId}/message_templates?fields=name,language,status,category,components,
   * seguindo `paging.next` até esgotar as páginas. Retorna a lista crua (upsert
   * e cálculo de bodyParamsCount ficam no TemplatesService).
   *
   * Endurecido contra resposta adulterada/paginação sem fim: `paging.next`
   * só é seguido se o host continuar `graph.facebook.com` (senão o
   * accessToken do canal vazaria como Bearer para um host arbitrário) e o
   * loop aborta após `MAX_TEMPLATE_SYNC_PAGES` páginas.
   */
  async syncTemplates(
    credentials: MetaChannelCredentials,
    wabaId: string,
  ): Promise<RawMetaTemplate[]> {
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
    if (!accessToken || !wabaId) {
      throw new GraphPermanentError(
        'Credenciais incompletas: accessToken e wabaId são obrigatórios',
      );
    }

    const templates: RawMetaTemplate[] = [];
    let next: string | null =
      `/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`;
    let pages = 0;

    while (next) {
      pages += 1;
      if (pages > MAX_TEMPLATE_SYNC_PAGES) {
        throw new Error(
          `Sincronização de templates excedeu ${MAX_TEMPLATE_SYNC_PAGES} páginas — abortando (paginação sem fim?)`,
        );
      }

      const response = await this.graphFetch(next, accessToken, { method: 'GET' });
      if (!response.ok) {
        throw new Error(await this.describeGraphError(response));
      }
      const body = (await response.json()) as {
        data?: RawMetaTemplate[];
        paging?: { next?: string };
      };
      templates.push(...(body.data ?? []));

      const rawNext = body.paging?.next ?? null;
      if (rawNext && rawNext.startsWith('http') && !rawNext.startsWith(GRAPH_HOST_PREFIX)) {
        throw new Error(
          `paging.next apontou para um host inesperado (esperado ${GRAPH_HOST_PREFIX}) — abortando por segurança`,
        );
      }
      next = rawNext;
    }

    return templates;
  }

  /**
   * Envia uma mensagem OUTBOUND via WhatsApp Cloud API.
   * Suporta TEXT, mídia por link (IMAGE/AUDIO/VIDEO/DOCUMENT/STICKER), LOCATION
   * e TEMPLATE ({templateName, language, params}). Tipos sem mapeamento →
   * GraphPermanentError.
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
      // Rate-limit (429/códigos de throughput) e 5xx retentam; demais 4xx são permanentes.
      await this.throwGraphSendError(response);
    }

    const body = (await response.json()) as { messages?: Array<{ id?: string }> };
    const externalId = body.messages?.[0]?.id;
    if (!externalId) {
      throw new Error('Graph API não retornou wamid na resposta de envio');
    }
    return { externalId };
  }

  /**
   * Perfil do usuário IG (nome/avatar) — BEST-EFFORT: nunca lança; retorna null
   * em token sem permissão, janela de acesso expirada, rede etc. O call site
   * usa fallback ('Instagram User').
   */
  async fetchInstagramProfile(
    credentials: MetaChannelCredentials,
    igUserId: string,
  ): Promise<InstagramProfile | null> {
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
    if (!accessToken || !igUserId) {
      return null;
    }
    try {
      const response = await this.graphFetch(
        `/${igUserId}?fields=name,profile_pic`,
        accessToken,
        { method: 'GET' },
      );
      if (!response.ok) {
        this.logger.warn(`Perfil IG indisponível: ${await this.describeGraphError(response)}`);
        return null;
      }
      const body = (await response.json()) as { name?: string; profile_pic?: string };
      return {
        name: typeof body.name === 'string' ? body.name : null,
        profilePicUrl: typeof body.profile_pic === 'string' ? body.profile_pic : null,
      };
    } catch (error) {
      this.logger.warn(`Falha ao buscar perfil IG: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Envia uma mensagem OUTBOUND via Instagram Direct (Graph API, formato Messenger):
   * POST /{ig_business_id}/messages com {recipient:{id}, message:{...}}.
   * Suporta TEXT e mídia por link (IMAGE/AUDIO/VIDEO → attachment nativo;
   * DOCUMENT → file; STICKER → image). Tipos sem mapeamento → GraphPermanentError.
   */
  async sendInstagramMessage(
    credentials: MetaChannelCredentials,
    recipientId: string,
    type: MessageType,
    content: Record<string, unknown>,
  ): Promise<GraphSendResult> {
    const { accessToken, igBusinessId } = this.requireInstagramCredentials(credentials);
    const payload = {
      recipient: { id: recipientId },
      message: this.buildInstagramMessagePayload(type, content),
    };

    const response = await this.graphFetch(`/${igBusinessId}/messages`, accessToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Rate-limit (429/códigos de throughput) e 5xx retentam; demais 4xx são permanentes.
      await this.throwGraphSendError(response);
    }

    const body = (await response.json()) as { message_id?: string };
    if (!body.message_id) {
      throw new Error('Graph API não retornou message_id na resposta de envio IG');
    }
    return { externalId: body.message_id };
  }

  private buildInstagramMessagePayload(
    type: MessageType,
    content: Record<string, unknown>,
  ): Record<string, unknown> {
    const text = typeof content.text === 'string' ? content.text : '';
    const mediaUrl = this.resolveMediaUrl(
      typeof content.mediaUrl === 'string' ? content.mediaUrl : '',
    );
    const attachment = (attachmentType: 'image' | 'audio' | 'video' | 'file') => ({
      attachment: { type: attachmentType, payload: { url: mediaUrl } },
    });

    switch (type) {
      case MessageType.TEXT:
        return { text };
      case MessageType.IMAGE:
      case MessageType.STICKER: // IG não tem sticker por link — degrada para imagem
        return attachment('image');
      case MessageType.AUDIO:
        return attachment('audio');
      case MessageType.VIDEO:
        return attachment('video');
      case MessageType.DOCUMENT:
        return attachment('file');
      case MessageType.SYSTEM:
        throw new GraphPermanentError('Mensagens SYSTEM não são entregues a canais');
      default:
        throw new GraphPermanentError(`Tipo de mensagem sem mapeamento Instagram Direct: ${type}`);
    }
  }

  private requireInstagramCredentials(credentials: MetaChannelCredentials): {
    accessToken: string;
    igBusinessId: string;
  } {
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
    const igBusinessId =
      typeof credentials.igBusinessId === 'string' ? credentials.igBusinessId : '';
    if (!accessToken || !igBusinessId) {
      throw new GraphPermanentError(
        'Credenciais incompletas: accessToken e igBusinessId são obrigatórios',
      );
    }
    return { accessToken, igBusinessId };
  }

  private buildMessagePayload(
    type: MessageType,
    content: Record<string, unknown>,
  ): Record<string, unknown> {
    const text = typeof content.text === 'string' ? content.text : '';
    const mediaUrl = this.resolveMediaUrl(
      typeof content.mediaUrl === 'string' ? content.mediaUrl : '',
    );
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
            // CONTRACTS §12: o campo é `language` (packages/shared/src/models.ts),
            // NÃO `languageCode` — fallback pt_BR mantido quando ausente.
            language: {
              code: typeof content.language === 'string' ? content.language : 'pt_BR',
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

  /**
   * Resolve `content.mediaUrl` para uma URL ABSOLUTA antes de montar o payload
   * da Graph API (crítico — sem isso, envio de anexo por upload quebra 100%
   * em WhatsApp/Instagram): `MediaService.storeUpload`/o re-host inbound
   * (CONTRACTS §6/§13) devolvem um caminho relativo same-origin
   * (`/api/media/{orgId}/...`) pensado para o browser do agente/composer, que
   * resolve relativo ao próprio host. Os servidores da Meta, porém, baixam a
   * mídia deles mesmos — um link sem scheme/host não é resolvível para eles.
   * `PUBLIC_URL` é o ÚNICO host público que serve web+api via Traefik
   * (CONTRACTS §2), então prefixá-lo é suficiente. URLs já absolutas (aba "Por
   * URL" do composer, sempre http(s) por `isHttpUrl`) passam intactas.
   */
  private resolveMediaUrl(mediaUrl: string): string {
    if (!mediaUrl || /^https?:\/\//i.test(mediaUrl)) {
      return mediaUrl;
    }
    const base = this.publicUrl.replace(/\/+$/, '');
    const path = mediaUrl.startsWith('/') ? mediaUrl : `/${mediaUrl}`;
    return `${base}${path}`;
  }

  /**
   * `path` pode ser um caminho relativo (`/…`) ou uma URL absoluta — usada ao
   * seguir `paging.next` da Graph API, que já vem com host/versão/query completos.
   */
  private graphFetch(path: string, accessToken: string, init: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${GRAPH_BASE_URL}/${this.graphVersion}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async describeGraphError(response: Response): Promise<string> {
    const { description } = await this.classifyGraphError(response);
    return description;
  }

  /** Códigos de rate-limit/throughput da Meta que chegam como 4xx mas são transientes. */
  private static readonly TRANSIENT_GRAPH_CODES = new Set([4, 17, 32, 613, 130429, 131056]);

  /**
   * Lê o corpo de erro UMA vez e classifica: rate-limit (429 ou codes de
   * throughput) e 5xx são transientes (retry BullMQ); demais 4xx, permanentes.
   */
  private async classifyGraphError(
    response: Response,
  ): Promise<{ description: string; transient: boolean }> {
    let description: string;
    let code: number | undefined;
    try {
      const body = (await response.json()) as GraphErrorBody;
      const message = body.error?.message ?? 'erro desconhecido';
      code = body.error?.code;
      description = `Graph API ${response.status}${code ? ` (code ${code})` : ''}: ${message}`;
    } catch {
      description = `Graph API ${response.status}: resposta não-JSON`;
    }
    const transient =
      response.status === 429 ||
      response.status >= 500 ||
      (code !== undefined && MetaGraphService.TRANSIENT_GRAPH_CODES.has(code));
    return { description, transient };
  }

  /** Lança GraphPermanentError (sem retry) ou Error comum (retry) conforme a classificação. */
  private async throwGraphSendError(response: Response): Promise<never> {
    const { description, transient } = await this.classifyGraphError(response);
    if (transient) {
      throw new Error(description);
    }
    throw new GraphPermanentError(description);
  }
}
