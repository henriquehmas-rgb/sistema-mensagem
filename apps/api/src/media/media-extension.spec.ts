import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CONTENT_TYPE,
  FALLBACK_EXTENSION,
  contentTypeForExtension,
  extensionForMime,
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
