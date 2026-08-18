import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { MetaChannelCredentials } from '../channels/meta-graph.service';
import type { Env } from '../config/env.validation';
import { contentTypeForExtension, extensionForMime } from './media-extension';

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const MAX_MEDIA_BYTES = 30 * 1024 * 1024; // limite do download (30MB)
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Regexes ESTRITAS dos segmentos da URL pública (anti path-traversal):
 * - orgId: cuid() do Prisma — minúsculas/dígitos, sem `.`/`/`/`\`;
 * - arquivo: 128 bits aleatórios em hex + extensão curta ([a-z0-9]).
 */
const ORG_ID_SEGMENT_REGEX = /^[a-z0-9]{20,40}$/;
const FILE_SEGMENT_REGEX = /^[0-9a-f]{32}\.[a-z0-9]{1,8}$/;

/** Resultado do re-host: caminho público (CONTRACTS §6) + mime detectado. */
export interface StoredMedia {
  /** Caminho público servido pela própria api: /api/media/{orgId}/{arquivo}. */
  mediaUrl: string;
  mimeType: string | null;
  /** Caminho absoluto no volume — permite limpeza de órfãos (dedupe pós-rehost). */
  absolutePath: string;
}

/**
 * Re-host de mídia inbound da Meta (CONTRACTS §6 / ARCHITECTURE):
 * a URL de mídia do WhatsApp expira em minutos e exige download autenticado —
 * `fetchAndStore` resolve o media id na Graph API, baixa com Bearer (30MB /
 * timeout) e grava em MEDIA_DIR/{orgId}/{uuid-128-bits}.{ext}. Segurança MVP:
 * o nome de arquivo aleatório torna a URL não-adivinhável (o link é o segredo).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly graphVersion: string;
  /** Raiz ABSOLUTA de mídia — base da verificação de prefixo do serve. */
  readonly mediaRoot: string;

  constructor(config: ConfigService<Env, true>) {
    this.graphVersion = config.get('META_GRAPH_VERSION', { infer: true });
    this.mediaRoot = path.resolve(config.get('MEDIA_DIR', { infer: true }));
  }

  /**
   * GET /{ver}/{mediaId} (Bearer) → {url, mime_type} → download autenticado →
   * arquivo em MEDIA_DIR/{orgId}/. Lança Error em falha (call sites decidem
   * entre fallback inline e retry via job 'media-fetch').
   */
  async fetchAndStore(
    orgId: string,
    mediaId: string,
    credentials: MetaChannelCredentials,
    options: { timeoutMs?: number } = {},
  ): Promise<StoredMedia> {
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : '';
    if (!accessToken) {
      throw new Error('Credenciais do canal sem accessToken — impossível baixar mídia');
    }
    // Um único deadline cobre metadados + download (inline usa timeout curto).
    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const metadata = await this.fetchMediaMetadata(mediaId, accessToken, signal);

    const download = await fetch(metadata.url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!download.ok || !download.body) {
      throw new Error(`Download de mídia falhou (HTTP ${download.status}) para ${mediaId}`);
    }
    const declaredLength = Number(download.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_MEDIA_BYTES) {
      throw new Error(`Mídia ${mediaId} excede o limite de ${MAX_MEDIA_BYTES} bytes`);
    }

    const mimeType = normalizeMime(metadata.mimeType ?? download.headers.get('content-type'));
    // 128 bits aleatórios em hex — URL não-adivinhável (CONTRACTS §6).
    const fileName = `${randomBytes(16).toString('hex')}.${extensionForMime(mimeType)}`;
    const orgDir = path.join(this.mediaRoot, orgId);
    await mkdir(orgDir, { recursive: true });
    const filePath = path.join(orgDir, fileName);

    try {
      await this.writeBounded(download.body as unknown as WebReadableStream, filePath);
    } catch (error) {
      await unlink(filePath).catch(() => undefined); // arquivo parcial — limpa
      throw error;
    }

    this.logger.log(`Mídia ${mediaId} re-hospedada em /api/media/${orgId}/${fileName}`);
    return { mediaUrl: `/api/media/${orgId}/${fileName}`, mimeType, absolutePath: filePath };
  }

  /** Remove um arquivo re-hospedado (best-effort) — usado quando a Message é duplicata. */
  async deleteStored(stored: StoredMedia): Promise<void> {
    const resolved = path.resolve(stored.absolutePath);
    if (!resolved.startsWith(this.mediaRoot + path.sep)) {
      return; // fora da raiz de mídia — nunca deletar
    }
    await unlink(resolved).catch(() => undefined);
  }

  /**
   * Valida e resolve o caminho de um arquivo servível (GET /api/media):
   * regex estrita nos dois segmentos, resolve absoluto e confere o prefixo da
   * raiz de mídia — QUALQUER desvio → 400; inexistente/não-arquivo → 404.
   */
  async resolveMediaFile(
    orgId: string,
    file: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    if (!ORG_ID_SEGMENT_REGEX.test(orgId) || !FILE_SEGMENT_REGEX.test(file)) {
      throw new BadRequestException('Caminho de mídia inválido');
    }
    const absolutePath = path.resolve(this.mediaRoot, orgId, file);
    if (!absolutePath.startsWith(this.mediaRoot + path.sep)) {
      throw new BadRequestException('Caminho de mídia inválido');
    }

    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      throw new NotFoundException('Mídia não encontrada');
    }
    if (!fileStat.isFile()) {
      throw new NotFoundException('Mídia não encontrada');
    }

    const extension = file.slice(file.lastIndexOf('.') + 1);
    return { absolutePath, contentType: contentTypeForExtension(extension) };
  }

  /** Metadados do media id: GET graph.facebook.com/{ver}/{mediaId} (Bearer). */
  private async fetchMediaMetadata(
    mediaId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<{ url: string; mimeType: string | null }> {
    const response = await fetch(`${GRAPH_BASE_URL}/${this.graphVersion}/${mediaId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Graph API ${response.status} ao resolver mídia ${mediaId}`);
    }
    const body = (await response.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };
    if (!body.url) {
      throw new Error(`Graph API sem url de download para mídia ${mediaId}`);
    }
    if (typeof body.file_size === 'number' && body.file_size > MAX_MEDIA_BYTES) {
      throw new Error(`Mídia ${mediaId} excede o limite de ${MAX_MEDIA_BYTES} bytes`);
    }
    return { url: body.url, mimeType: typeof body.mime_type === 'string' ? body.mime_type : null };
  }

  /** Escreve o stream em disco abortando se ultrapassar MAX_MEDIA_BYTES. */
  private async writeBounded(body: WebReadableStream, filePath: string): Promise<void> {
    let total = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.byteLength;
        if (total > MAX_MEDIA_BYTES) {
          callback(new Error(`Mídia excede o limite de ${MAX_MEDIA_BYTES} bytes`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(body), sizeGuard, createWriteStream(filePath, { flags: 'wx' }));
  }
}

/** Normaliza o mime (minúsculas, sem parâmetros ';codecs=...'). */
function normalizeMime(mimeType: string | null | undefined): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}
