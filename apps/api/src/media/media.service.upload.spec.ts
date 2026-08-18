import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.validation';
import type { RedisService } from '../redis/redis.service';
import { MAX_UPLOAD_BYTES } from './multer-upload.options';
import { MediaService } from './media.service';

/**
 * MediaService.storeUpload (CONTRACTS §13) — upload de mídia outbound:
 * whitelist de mime, limite de tamanho e caminho gravado com o segmento
 * `uploads` entre orgId e o arquivo. Reaproveita o mesmo esquema de nome
 * aleatório (128 bits hex) do re-host inbound.
 */

const ORG_ID = 'cmed1aaaaaaaaaaaaaaaaaaaa'; // formato cuid()

let mediaDir: string;
let service: MediaService;

beforeEach(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), 'sm-media-upload-'));
  const config = {
    get: (key: string) => (key === 'MEDIA_DIR' ? mediaDir : key === 'META_GRAPH_VERSION' ? 'v21.0' : undefined),
  } as unknown as ConfigService<Env, true>;
  service = new MediaService(config);
});

afterEach(() => {
  rmSync(mediaDir, { recursive: true, force: true });
});

function configFactory(overrides: { dailyQuota?: number } = {}): ConfigService<Env, true> {
  return {
    get: (key: string) => {
      if (key === 'MEDIA_DIR') return mediaDir;
      if (key === 'META_GRAPH_VERSION') return 'v21.0';
      if (key === 'UPLOAD_DAILY_QUOTA_PER_ORG') return overrides.dailyQuota ?? 300;
      return undefined;
    },
  } as unknown as ConfigService<Env, true>;
}

/** Fake mínimo de RedisService — INCR/EXPIRE em memória, sem depender de Redis real. */
function fakeRedis(): RedisService {
  const store = new Map<string, number>();
  return {
    client: {
      incr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }),
      expire: vi.fn(async () => 1),
    },
  } as unknown as RedisService;
}

function fileOf(overrides: Partial<{ buffer: Buffer; mimetype: string; size: number; originalname: string }> = {}) {
  const buffer = overrides.buffer ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]); // assinatura jpeg válida
  return {
    buffer,
    mimetype: overrides.mimetype ?? 'image/jpeg',
    size: overrides.size ?? buffer.length,
    originalname: overrides.originalname,
  };
}

describe('MediaService.storeUpload', () => {
  it('grava em MEDIA_DIR/{orgId}/uploads/{arquivo} e retorna o DTO da CONTRACTS §13', async () => {
    const result = await service.storeUpload(ORG_ID, fileOf({ originalname: 'foto.jpg' }));

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.filename).toBe('foto.jpg');
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.mediaUrl).toMatch(
      new RegExp(`^/api/media/${ORG_ID}/uploads/[0-9a-f]{32}\\.jpg$`),
    );

    const uploadsDir = path.join(mediaDir, ORG_ID, 'uploads');
    expect(existsSync(uploadsDir)).toBe(true);
    const files = readdirSync(uploadsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  it('sem originalname usável → filename cai para o nome gerado no disco', async () => {
    const result = await service.storeUpload(ORG_ID, fileOf());
    expect(result.filename).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  it('rejeita mime fora da whitelist (ex.: application/zip)', async () => {
    await expect(
      service.storeUpload(ORG_ID, fileOf({ mimetype: 'application/zip' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita mime fora da whitelist mesmo dentro de uma família ampla (video/webm)', async () => {
    // CONTRACTS §13 permite só video/mp4, não video/* genérico.
    await expect(
      service.storeUpload(ORG_ID, fileOf({ mimetype: 'video/webm' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita SVG (XSS via mídia servida inline) mesmo sendo "image/*"', async () => {
    await expect(
      service.storeUpload(ORG_ID, fileOf({ mimetype: 'image/svg+xml' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita tamanho excedente (> 20MB)', async () => {
    await expect(
      service.storeUpload(ORG_ID, fileOf({ size: MAX_UPLOAD_BYTES + 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita quando o Content-Type declarado não bate com a assinatura do conteúdo', async () => {
    // PNG de verdade declarado como jpeg — o Content-Type do cliente sozinho não basta.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      service.storeUpload(ORG_ID, fileOf({ buffer: pngBytes, mimetype: 'image/jpeg' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita arquivo vazio', async () => {
    await expect(
      service.storeUpload(ORG_ID, fileOf({ buffer: Buffer.alloc(0), size: 0 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duas orgs distintas nunca compartilham a subpasta uploads', async () => {
    const otherOrg = 'cmed1bbbbbbbbbbbbbbbbbbbb';
    await service.storeUpload(ORG_ID, fileOf());
    await service.storeUpload(otherOrg, fileOf());

    expect(readdirSync(path.join(mediaDir, ORG_ID, 'uploads'))).toHaveLength(1);
    expect(readdirSync(path.join(mediaDir, otherOrg, 'uploads'))).toHaveLength(1);
  });
});

/**
 * Cota diária de uploads por org (CONTRACTS §13, correção de revisão — high):
 * defesa contra esgotamento de disco do volume media_data compartilhado entre
 * TODAS as orgs (anexo descartado no client sem DELETE + probing não
 * autenticado de POST /webchat/uploads).
 */
describe('MediaService.storeUpload — cota diária por org (Redis)', () => {
  it('permite uploads até a cota e bloqueia o que a excede com 429', async () => {
    const svc = new MediaService(configFactory({ dailyQuota: 2 }), fakeRedis());

    await expect(svc.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
    await expect(svc.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
    await expect(svc.storeUpload(ORG_ID, fileOf())).rejects.toBeInstanceOf(HttpException);
  });

  it('a cota é POR ORG — uma org estourada não afeta as demais', async () => {
    const svc = new MediaService(configFactory({ dailyQuota: 1 }), fakeRedis());
    const otherOrg = 'cmed1bbbbbbbbbbbbbbbbbbbb';

    await expect(svc.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
    await expect(svc.storeUpload(ORG_ID, fileOf())).rejects.toBeInstanceOf(HttpException);
    await expect(svc.storeUpload(otherOrg, fileOf())).resolves.toBeDefined();
  });

  it('upload rejeitado por mime/tamanho NÃO consome a cota', async () => {
    const svc = new MediaService(configFactory({ dailyQuota: 1 }), fakeRedis());

    await expect(
      svc.storeUpload(ORG_ID, fileOf({ mimetype: 'application/zip' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    // a cota (1) segue inteira — a tentativa inválida não gravou nada em disco.
    await expect(svc.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
  });

  it('sem RedisService (construção manual sem DI) → cota ignorada, fail-open', async () => {
    // `service` do beforeEach é construído com um único argumento (config),
    // igual ao resto da suíte pré-existente — sem redis, a cota nunca conta.
    for (let i = 0; i < 5; i += 1) {
      await expect(service.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
    }
  });

  it('erro de conexão com o Redis → fail-open (upload segue mesmo assim)', async () => {
    const redis = {
      client: {
        incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        expire: vi.fn(),
      },
    } as unknown as RedisService;
    const svc = new MediaService(configFactory({ dailyQuota: 1 }), redis);

    await expect(svc.storeUpload(ORG_ID, fileOf())).resolves.toBeDefined();
  });
});

/**
 * Helpers de varredura usados pelo job de limpeza de uploads órfãos
 * (MediaCleanupService) — listOrgIds/listOrgUploadFiles/deleteUploadFile.
 */
describe('MediaService — helpers de varredura para limpeza de uploads', () => {
  it('listOrgIds só lista diretórios com formato válido de orgId', async () => {
    await service.storeUpload(ORG_ID, fileOf());
    mkdirSync(path.join(mediaDir, 'não-é-um-orgid!'), { recursive: true });

    const orgIds = await service.listOrgIds();
    expect(orgIds).toEqual([ORG_ID]);
  });

  it('MEDIA_DIR ausente → listOrgIds retorna vazio (nunca lança)', async () => {
    rmSync(mediaDir, { recursive: true, force: true });
    await expect(service.listOrgIds()).resolves.toEqual([]);
  });

  it('listOrgUploadFiles lista os arquivos de uploads/ da org com mtime', async () => {
    const stored = await service.storeUpload(ORG_ID, fileOf());
    const fileName = stored.mediaUrl.split('/').pop() as string;

    const files = await service.listOrgUploadFiles(ORG_ID);
    expect(files).toHaveLength(1);
    expect(files[0]?.fileName).toBe(fileName);
    expect(files[0]?.absolutePath).toBe(path.join(mediaDir, ORG_ID, 'uploads', fileName));
    expect(files[0]?.mtimeMs).toBeGreaterThan(0);
  });

  it('org sem pasta uploads/ → listOrgUploadFiles retorna vazio', async () => {
    await expect(service.listOrgUploadFiles(ORG_ID)).resolves.toEqual([]);
  });

  it('orgId com formato inválido → listOrgUploadFiles retorna vazio sem tocar o disco', async () => {
    await expect(service.listOrgUploadFiles('../etc')).resolves.toEqual([]);
  });

  it('deleteUploadFile remove o arquivo dentro da raiz de mídia', async () => {
    const stored = await service.storeUpload(ORG_ID, fileOf());
    const fileName = stored.mediaUrl.split('/').pop() as string;
    const absolutePath = path.join(mediaDir, ORG_ID, 'uploads', fileName);
    expect(existsSync(absolutePath)).toBe(true);

    await service.deleteUploadFile(absolutePath);
    expect(existsSync(absolutePath)).toBe(false);
  });

  it('deleteUploadFile NUNCA remove arquivo fora da raiz de mídia', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'sm-media-outside-'));
    const outsideFile = path.join(outside, 'segredo.jpg');
    writeFileSync(outsideFile, 'segredo');

    try {
      await service.deleteUploadFile(outsideFile);
      expect(existsSync(outsideFile)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('mtime reflete arquivos antigos (usado pelo TTL do job de limpeza)', async () => {
    const stored = await service.storeUpload(ORG_ID, fileOf());
    const fileName = stored.mediaUrl.split('/').pop() as string;
    const absolutePath = path.join(mediaDir, ORG_ID, 'uploads', fileName);
    const past = new Date(Date.now() - 72 * 60 * 60 * 1000);
    utimesSync(absolutePath, past, past);

    const [file] = await service.listOrgUploadFiles(ORG_ID);
    expect(file?.mtimeMs).toBeLessThanOrEqual(past.getTime() + 1000);
  });
});
