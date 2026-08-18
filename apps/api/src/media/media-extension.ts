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

// ---------------------------------------------------------------------------
// Upload de mídia OUTBOUND (CONTRACTS §13) — whitelist fechada e distinta do
// mapeamento inbound acima: cobre exatamente image/*, audio/*, video/mp4,
// application/pdf e os tipos de Document do WhatsApp Cloud API. Fechada (em
// vez de aceitar qualquer subtipo image/audio) porque só aceitamos mimes com
// extensão conhecida em MIME_TO_EXTENSION — um subtipo desconhecido cairia no
// fallback `.bin`/octet-stream ao servir de volta, quebrando a exibição.
// ---------------------------------------------------------------------------

const UPLOAD_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);

const UPLOAD_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const UPLOAD_AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
]);

/**
 * Whitelist de upload outbound (CONTRACTS §13): image/*, audio/*, video/mp4,
 * application/pdf e os tipos de Document do WhatsApp. Mime já normalizado
 * (minúsculas, sem parâmetros) é responsabilidade do chamador.
 */
export function isAllowedUploadMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  return (
    UPLOAD_IMAGE_MIME_TYPES.has(mimeType) ||
    UPLOAD_AUDIO_MIME_TYPES.has(mimeType) ||
    mimeType === 'video/mp4' ||
    UPLOAD_DOCUMENT_MIME_TYPES.has(mimeType)
  );
}

/**
 * Assinatura binária (magic bytes) para os mimes mais comuns/fáceis de
 * forjar. **Limitação documentada (MVP)**: cobrimos só os formatos com
 * assinatura simples e inequívoca (imagens + PDF); áudio/vídeo (contêineres
 * variados) e os documentos do Office (DOC/XLS/PPT são OLE; DOCX/XLSX/PPTX
 * são ZIP — todos com assinaturas ambíguas entre si) NÃO são verificados por
 * assinatura — para esses o mimetype reportado pelo multer/navegador é
 * aceito como está, conforme CONTRACTS §13.
 */
const MAGIC_BYTES_VERIFIERS: Readonly<Record<string, (buffer: Buffer) => boolean>> = {
  'image/jpeg': (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png': (buf) =>
    buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (buf) =>
    buf.length >= 6 &&
    (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a'),
  'image/webp': (buf) =>
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (buf) => buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-',
};

/**
 * true SÓ quando temos um verificador para o mime declarado E o conteúdo não
 * bate com a assinatura esperada (spoofing detectado). Mime sem verificador
 * conhecido nunca é bloqueado aqui (ver limitação documentada acima).
 */
export function magicBytesLikelyMismatch(mimeType: string, buffer: Buffer): boolean {
  const verify = MAGIC_BYTES_VERIFIERS[mimeType];
  if (!verify) {
    return false;
  }
  return !verify(buffer);
}
