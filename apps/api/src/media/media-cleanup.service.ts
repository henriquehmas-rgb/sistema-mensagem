import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

/** Tipos de MessageType cujo `content` pode carregar `mediaUrl` (CONTRACTS §3). */
const MEDIA_MESSAGE_TYPES: MessageType[] = [
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.DOCUMENT,
  MessageType.STICKER,
];

/** TTL de retenção de upload órfão (CONTRACTS §13) — 48h. */
export const UPLOAD_ORPHAN_TTL_MS = 48 * 60 * 60 * 1000;

export interface MediaCleanupResult {
  scannedOrgs: number;
  deletedFiles: number;
}

/**
 * Limpeza de uploads outbound órfãos (CONTRACTS §13, correção de revisão —
 * high): `MediaService.storeUpload` nunca teve TTL/cleanup — diferente do
 * re-host inbound (que tem `deleteStored` no caminho de dedupe do
 * webhook-ingest.processor), um upload outbound ficava para sempre em
 * MEDIA_DIR/{orgId}/uploads/, mesmo quando:
 * (1) o agente estagia um anexo no composer e descarta antes de enviar
 *     (`setAttachment(null)`, sem DELETE nenhum ao servidor);
 * (2) um script chama POST /webchat/uploads repetidamente com um
 *     visitorToken válido sem NUNCA enviar POST /webchat/messages — nenhuma
 *     Message chega a existir, então nenhum caminho de limpeza pré-existente
 *     dispara.
 * Roda via job repetível BullMQ (MediaCleanupScheduler + MediaCleanupProcessor):
 * para cada org com pasta uploads/, arquivos com mais de `UPLOAD_ORPHAN_TTL_MS`
 * (mtime) que NENHUMA Message.content.mediaUrl da própria org referencia são
 * removidos. Best-effort: nunca lança — erro em uma org não aborta as demais.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
  ) {}

  async run(now: number = Date.now()): Promise<MediaCleanupResult> {
    const orgIds = await this.media.listOrgIds();
    let deletedFiles = 0;

    for (const orgId of orgIds) {
      try {
        deletedFiles += await this.cleanupOrg(orgId, now);
      } catch (error) {
        // Uma org com erro (ex.: falha pontual de I/O) não pode travar a
        // varredura das demais — best-effort, loga e segue.
        this.logger.warn(`Falha ao limpar uploads da org ${orgId}: ${(error as Error).message}`);
      }
    }

    if (deletedFiles > 0) {
      this.logger.log(
        `Limpeza de uploads órfãos: ${deletedFiles} arquivo(s) removido(s) em ${orgIds.length} org(s) verificadas`,
      );
    }
    return { scannedOrgs: orgIds.length, deletedFiles };
  }

  private async cleanupOrg(orgId: string, now: number): Promise<number> {
    const files = await this.media.listOrgUploadFiles(orgId);
    if (files.length === 0) {
      return 0; // nada em disco — nem vale consultar o banco.
    }

    const referenced = await this.loadReferencedUploadUrls(orgId);
    let deleted = 0;
    for (const file of files) {
      if (now - file.mtimeMs < UPLOAD_ORPHAN_TTL_MS) {
        continue; // ainda dentro do TTL — pode estar em uso (envio em andamento, retry etc.)
      }
      const mediaUrl = `/api/media/${orgId}/uploads/${file.fileName}`;
      if (referenced.has(mediaUrl)) {
        continue; // referenciado por alguma Message — nunca deletar.
      }
      await this.media.deleteUploadFile(file.absolutePath);
      deleted += 1;
    }
    return deleted;
  }

  /**
   * Todas as mediaUrl de upload da org já usadas em alguma Message — sem
   * limite de tempo (uma Message antiga continua referenciando seu anexo
   * indefinidamente). Filtra por MessageType para não trazer o histórico de
   * texto inteiro da org, só o necessário para decidir o que preservar.
   */
  private async loadReferencedUploadUrls(orgId: string): Promise<Set<string>> {
    const messages = await this.prisma.prismaSystem.message.findMany({
      where: { orgId, type: { in: MEDIA_MESSAGE_TYPES } },
      select: { content: true },
    });

    const referenced = new Set<string>();
    for (const { content } of messages) {
      const mediaUrl =
        content && typeof content === 'object' && !Array.isArray(content)
          ? (content as Record<string, unknown>).mediaUrl
          : undefined;
      if (typeof mediaUrl === 'string') {
        referenced.add(mediaUrl);
      }
    }
    return referenced;
  }
}
