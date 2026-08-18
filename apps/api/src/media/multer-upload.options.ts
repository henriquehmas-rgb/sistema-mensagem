import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

/** Limite de upload outbound — CONTRACTS §13 (20MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Opções do multer compartilhadas por POST /uploads (agente autenticado) e
 * POST /webchat/uploads (visitante): storage em MEMÓRIA (o arquivo só toca
 * disco depois de passar pela validação de mime/tamanho em
 * `MediaService.storeUpload`) e `limits.fileSize` — o PRÓPRIO interceptor
 * (busboy) aborta o upload assim que ultrapassa o limite, virando
 * 413 PayloadTooLargeException automaticamente (ver
 * @nestjs/platform-express/multer/multer/multer.utils.ts transformException).
 * `storeUpload` confere o tamanho de novo por defesa em profundidade.
 */
export function createUploadMulterOptions(): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  };
}
