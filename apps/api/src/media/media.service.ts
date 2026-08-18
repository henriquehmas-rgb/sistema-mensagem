import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { MetaChannelCredentials } from '../channels/meta-graph.service';
import type { Env } from '../config/env.validation';
import type { RedisService } from '../redis/redis.service';
import {
  contentTypeForExtension,
  extensionForMime,
  isAllowedUploadMime,
  magicBytesLikelyMismatch,
} from './media-extension';
import { MAX_UPLOAD_BYTES } from './multer-upload.options';

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const MAX_MEDIA_BYTES = 30 * 1024 * 1024; // limite do download (30MB)
const DEFAULT_TIMEOUT_MS = 20_000;

/** Subpasta fixa do upload outbound dentro de MEDIA_DIR/{orgId}/ (CONTRACTS §13). */
const UPLOADS_SUBDIR = 'uploads';

/**
 * Regexes ESTRITAS dos segmentos da URL pública (anti path-traversal):
 * - orgId: cuid() do Prisma — minúsculas/dígitos, sem `.`/`/`/`\`;
 * - arquivo: 128 bits aleatórios em hex + extensão curta ([a-z0-9]).
 */
const ORG_ID_SEGMENT_REGEX = /^[a-z0-9]{20,40}$/;
const FILE_SEGMENT_REGEX = /^[0-9a-f]{32}\.[a-z0-9]{1,8}$/;

/** Arquivo recebido via multipart (campo mínimo usado por storeUpload). */
export interface UploadFileInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
  /** Nome original do cliente — só para exibição (NUNCA usado no caminho no disco). */
  originalname?: string;
}

/** Resposta de POST /uploads e POST /webchat/uploads (CONTRACTS §13). */
export interface StoredUpload {
  mediaUrl: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

/** Um arquivo de upload outbound encontrado em disco (MediaCleanupService). */
export interface UploadFileEntry {
  fileName: string;
  absolutePath: string;
  mtimeMs: number;
}

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
  /** Cota diária de uploads outbound por org (CONTRACTS §13) — defesa contra esgotamento de disco. */
  private readonly dailyUploadQuota: number;

  constructor(
    config: ConfigService<Env, true>,
    // Opcional: RedisService vem do RedisModule (@Global), sempre disponível
    // quando o Nest resolve a árvore de DI real. Só fica undefined nos testes
    // unitários que instanciam `new MediaService(config)` sem ele — nesse caso
    // a cota é ignorada (fail-open), o comportamento pré-existente do serviço.
    @Optional() private readonly redis?: RedisService,
  ) {
    this.graphVersion = config.get('META_GRAPH_VERSION', { infer: true });
    this.mediaRoot = path.resolve(config.get('MEDIA_DIR', { infer: true }));
    this.dailyUploadQuota = config.get('UPLOAD_DAILY_QUOTA_PER_ORG', { infer: true });
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
   * Upload de mídia OUTBOUND (CONTRACTS §13): agente autenticado (POST
   * /uploads) e visitante do webchat (POST /webchat/uploads) — MESMA validação
   * para os dois. Whitelist de mime (nunca confia só no Content-Type
   * declarado: normaliza + confere assinatura binária quando há verificador
   * conhecido, ver media-extension.ts) + limite de tamanho (defesa em
   * profundidade — o interceptor multer já corta antes de chegar aqui) +
   * nome de arquivo aleatório (o `originalname` do cliente NUNCA compõe o
   * caminho no disco — path-traversal via nome de arquivo é portanto
   * irrelevante, só usado para exibição na resposta).
   */
  async storeUpload(orgId: string, file: UploadFileInput): Promise<StoredUpload> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Arquivo vazio ou ausente');
    }
    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`Arquivo excede o limite de ${MAX_UPLOAD_BYTES} bytes`);
    }

    const mimeType = normalizeMime(file.mimetype);
    if (!isAllowedUploadMime(mimeType)) {
      throw new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}`);
    }
    if (mimeType && magicBytesLikelyMismatch(mimeType, file.buffer)) {
      throw new BadRequestException('Conteúdo do arquivo não corresponde ao tipo declarado');
    }
    // Cota diária por org (CONTRACTS §13) — SÓ conta upload que efetivamente
    // vai passar a existir em disco (depois de todas as rejeições acima),
    // para não penalizar uma org por tentativas inválidas de terceiros.
    await this.enforceDailyQuota(orgId);

    // 128 bits aleatórios em hex — mesmo esquema do re-host inbound (link é o segredo).
    const fileName = `${randomBytes(16).toString('hex')}.${extensionForMime(mimeType)}`;
    const uploadDir = path.join(this.mediaRoot, orgId, UPLOADS_SUBDIR);
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, file.buffer, { flag: 'wx' });

    this.logger.log(`Upload outbound armazenado em /api/media/${orgId}/${UPLOADS_SUBDIR}/${fileName}`);
    return {
      mediaUrl: `/api/media/${orgId}/${UPLOADS_SUBDIR}/${fileName}`,
      mimeType: mimeType as string,
      filename: sanitizeDisplayFilename(file.originalname) ?? fileName,
      sizeBytes: file.size,
    };
  }

  /**
   * Cota diária de uploads outbound por org (CONTRACTS §13): contador no Redis
   * (`sm:upload-quota:{orgId}:{AAAA-MM-DD}`, TTL ~26h) — INCR + checagem contra
   * `UPLOAD_DAILY_QUOTA_PER_ORG`. Mitiga o vetor de esgotamento de disco do
   * volume compartilhado entre TODAS as orgs (staging de anexo nunca
   * descartado no client + probing não autenticado de POST /webchat/uploads
   * sem nunca enviar a mensagem). Fail-open: sem RedisService injetado (só
   * ocorre em teste unitário construindo o serviço manualmente) ou em erro de
   * conexão com o Redis, a cota é ignorada e o upload segue — Redis já é uma
   * dependência crítica do resto da aplicação (BullMQ, socket adapter), então
   * uma indisponibilidade dele não deve ser o único motivo de um upload falhar.
   */
  private async enforceDailyQuota(orgId: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10); // AAAA-MM-DD (UTC)
    const key = `sm:upload-quota:${orgId}:${today}`;
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) {
        await this.redis.client.expire(key, 26 * 60 * 60); // folga sobre as 24h do dia UTC
      }
      if (count > this.dailyUploadQuota) {
        throw new HttpException(
          `Cota diária de uploads (${this.dailyUploadQuota}) excedida para esta organização`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // cota realmente excedida — nunca engolir
      }
      this.logger.warn(`Falha ao checar cota de upload no Redis (fail-open): ${(error as Error).message}`);
    }
  }

  /**
   * Lista os orgIds com pasta própria em MEDIA_DIR (nome do diretório = orgId,
   * validado pela mesma regex do serve). Usado pelo job de limpeza de uploads
   * órfãos (CONTRACTS §13, MediaCleanupService) — nunca pelo caminho de
   * request normal.
   */
  async listOrgIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.mediaRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isDirectory() && ORG_ID_SEGMENT_REGEX.test(entry.name))
      .map((entry) => entry.name);
  }

  /**
   * Lista os arquivos de upload outbound de uma org (MEDIA_DIR/{orgId}/uploads/)
   * com o mtime de cada um — usado pelo job de limpeza para decidir o que já
   * passou do TTL de retenção. Nunca lança: pasta ausente vira lista vazia.
   */
  async listOrgUploadFiles(orgId: string): Promise<UploadFileEntry[]> {
    if (!ORG_ID_SEGMENT_REGEX.test(orgId)) {
      return [];
    }
    const uploadDir = path.join(this.mediaRoot, orgId, UPLOADS_SUBDIR);
    let entries;
    try {
      entries = await readdir(uploadDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: UploadFileEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_SEGMENT_REGEX.test(entry.name)) {
        continue;
      }
      const absolutePath = path.join(uploadDir, entry.name);
      try {
        const info = await stat(absolutePath);
        files.push({ fileName: entry.name, absolutePath, mtimeMs: info.mtimeMs });
      } catch {
        // removido entre o readdir e o stat — ignora, próxima varredura resolve.
      }
    }
    return files;
  }

  /**
   * Remove um upload órfão (best-effort, CONTRACTS §13) — usado pelo job de
   * limpeza. Mesma checagem de prefixo de `deleteStored`: NUNCA deleta fora da
   * raiz de mídia, mesmo que o chamador passe um caminho inesperado.
   */
  async deleteUploadFile(absolutePath: string): Promise<void> {
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(this.mediaRoot + path.sep)) {
      return;
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
    return this.resolveStoredFile(orgId, null, file);
  }

  /**
   * Mesma validação de resolveMediaFile, para o path de 3 segmentos do upload
   * outbound: GET /api/media/{orgId}/uploads/{arquivo} (CONTRACTS §13). O
   * segmento `uploads` é um literal fixo da rota (não um param) — só chega
   * aqui quando o Express já casou exatamente esse segmento, o que é mais
   * estrito que qualquer regex.
   */
  async resolveUploadFile(
    orgId: string,
    file: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    return this.resolveStoredFile(orgId, UPLOADS_SUBDIR, file);
  }

  private async resolveStoredFile(
    orgId: string,
    subdir: string | null,
    file: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    if (!ORG_ID_SEGMENT_REGEX.test(orgId) || !FILE_SEGMENT_REGEX.test(file)) {
      throw new BadRequestException('Caminho de mídia inválido');
    }
    const absolutePath = subdir
      ? path.resolve(this.mediaRoot, orgId, subdir, file)
      : path.resolve(this.mediaRoot, orgId, file);
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

/**
 * Nome de exibição do upload (resposta da API): remove qualquer diretório
 * embutido e caracteres de controle do `originalname` do cliente — NUNCA
 * usado para compor caminho no disco (isso já é 128 bits aleatórios), só
 * para o composer/widget mostrarem o nome do arquivo.
 */
function sanitizeDisplayFilename(name: string | undefined): string | null {
  if (!name) {
    return null;
  }
  const base = name.replace(/^.*[/\\]/, '');
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle do nome exibido
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : null;
}
