/**
 * Mapeamentos mime ⇄ extensão para a mídia inbound re-hospedada (CONTRACTS §6).
 * Cobre os tipos aceitos pelo WhatsApp Cloud API (imagem/áudio/vídeo/sticker/
 * documento). `image/svg+xml` fica FORA de propósito: SVG servido inline pode
 * executar script (XSS) — mime desconhecido cai no fallback binário.
 */

export const FALLBACK_EXTENSION = 'bin';
export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  aac: 'audio/aac',
  amr: 'audio/amr',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/quicktime',
  webm: 'video/webm',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  bin: FALLBACK_CONTENT_TYPE,
};

/** Extensão do arquivo local a partir do mime (parâmetros ';...' ignorados). */
export function extensionForMime(mimeType: string | null | undefined): string {
  if (!mimeType) {
    return FALLBACK_EXTENSION;
  }
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXTENSION[normalized] ?? FALLBACK_EXTENSION;
}

/** Content-Type servido pelo GET /api/media a partir da extensão do arquivo. */
export function contentTypeForExtension(extension: string): string {
  return EXTENSION_TO_CONTENT_TYPE[extension.toLowerCase()] ?? FALLBACK_CONTENT_TYPE;
}
