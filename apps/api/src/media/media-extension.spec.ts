import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CONTENT_TYPE,
  FALLBACK_EXTENSION,
  contentTypeForExtension,
  extensionForMime,
  isAllowedUploadMime,
  magicBytesLikelyMismatch,
} from './media-extension';

describe('extensionForMime', () => {
  it('resolve os mimes de mídia do WhatsApp Cloud API', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('application/pdf')).toBe('pdf');
    expect(
      extensionForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
  });

  it('ignora parâmetros do mime (ex.: codecs do áudio de voz)', () => {
    expect(extensionForMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensionForMime('image/jpeg; charset=binary')).toBe('jpg');
  });

  it('é case-insensitive e tolera espaços', () => {
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg');
    expect(extensionForMime('  video/mp4  ')).toBe('mp4');
  });

  it('mime desconhecido/ausente cai no fallback binário', () => {
    expect(extensionForMime('application/x-desconhecido')).toBe(FALLBACK_EXTENSION);
    expect(extensionForMime('')).toBe(FALLBACK_EXTENSION);
    expect(extensionForMime(null)).toBe(FALLBACK_EXTENSION);
    expect(extensionForMime(undefined)).toBe(FALLBACK_EXTENSION);
  });

  it('NUNCA resolve SVG (XSS via mídia servida inline)', () => {
    expect(extensionForMime('image/svg+xml')).toBe(FALLBACK_EXTENSION);
  });
});

describe('contentTypeForExtension', () => {
  it('reverte a extensão para o Content-Type canônico', () => {
    expect(contentTypeForExtension('jpg')).toBe('image/jpeg');
    expect(contentTypeForExtension('ogg')).toBe('audio/ogg');
    expect(contentTypeForExtension('mp4')).toBe('video/mp4');
    expect(contentTypeForExtension('pdf')).toBe('application/pdf');
    expect(contentTypeForExtension('bin')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('extensão desconhecida → application/octet-stream', () => {
    expect(contentTypeForExtension('exe')).toBe(FALLBACK_CONTENT_TYPE);
    expect(contentTypeForExtension('')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('roundtrip mime → extensão → content-type é estável', () => {
    for (const mime of ['image/jpeg', 'image/png', 'audio/mpeg', 'video/mp4', 'application/pdf']) {
      expect(contentTypeForExtension(extensionForMime(mime))).toBe(mime);
    }
  });
});

describe('isAllowedUploadMime (CONTRACTS §13 — whitelist do upload outbound)', () => {
  it('aceita image/*, audio/*, video/mp4 e application/pdf', () => {
    expect(isAllowedUploadMime('image/jpeg')).toBe(true);
    expect(isAllowedUploadMime('image/png')).toBe(true);
    expect(isAllowedUploadMime('audio/mpeg')).toBe(true);
    expect(isAllowedUploadMime('audio/ogg')).toBe(true);
    expect(isAllowedUploadMime('video/mp4')).toBe(true);
    expect(isAllowedUploadMime('application/pdf')).toBe(true);
  });

  it('aceita os tipos de Document do WhatsApp Cloud API', () => {
    expect(isAllowedUploadMime('application/msword')).toBe(true);
    expect(
      isAllowedUploadMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(true);
    expect(isAllowedUploadMime('application/vnd.ms-excel')).toBe(true);
    expect(isAllowedUploadMime('text/plain')).toBe(true);
  });

  it('rejeita mime fora da whitelist', () => {
    expect(isAllowedUploadMime('video/webm')).toBe(false); // só video/mp4, não video/*
    expect(isAllowedUploadMime('application/zip')).toBe(false);
    expect(isAllowedUploadMime('application/x-msdownload')).toBe(false);
    expect(isAllowedUploadMime('image/svg+xml')).toBe(false); // XSS via SVG inline
    expect(isAllowedUploadMime('')).toBe(false);
    expect(isAllowedUploadMime(null)).toBe(false);
    expect(isAllowedUploadMime(undefined)).toBe(false);
  });
});

describe('magicBytesLikelyMismatch (assinatura binária)', () => {
  it('detecta PNG declarado como jpeg (spoofing)', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(magicBytesLikelyMismatch('image/jpeg', pngBytes)).toBe(true);
  });

  it('aceita conteúdo cuja assinatura bate com o mime declarado', () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pdfBytes = Buffer.from('%PDF-1.4\n...');
    expect(magicBytesLikelyMismatch('image/jpeg', jpegBytes)).toBe(false);
    expect(magicBytesLikelyMismatch('image/png', pngBytes)).toBe(false);
    expect(magicBytesLikelyMismatch('application/pdf', pdfBytes)).toBe(false);
  });

  it('mime sem verificador conhecido nunca é bloqueado (limitação documentada)', () => {
    expect(magicBytesLikelyMismatch('audio/mpeg', Buffer.from('qualquer coisa'))).toBe(false);
    expect(
      magicBytesLikelyMismatch(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Buffer.from('PK\x03\x04...'),
      ),
    ).toBe(false);
  });
});
