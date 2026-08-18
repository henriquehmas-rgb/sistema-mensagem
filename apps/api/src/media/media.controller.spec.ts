import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.validation';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/**
 * Path-traversal do GET /api/media/:orgId/:file (CONTRACTS §6): segmentos
 * inválidos/tentativas de escape → 400; caminho válido inexistente → 404;
 * arquivo real → sendFile com Content-Type/cache imutável. O Express decodifica
 * %2e/%2f ANTES dos params — os testes cobrem as formas decodificadas e as
 * literais.
 */

const ORG_ID = 'cmed1aaaaaaaaaaaaaaaaaaaa'; // formato cuid()
const FILE_NAME = `${randomBytes(16).toString('hex')}.png`;

let mediaDir: string;
let controller: MediaController;

function createResponse(): Response {
  return { setHeader: vi.fn(), sendFile: vi.fn() } as unknown as Response;
}

beforeEach(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), 'sm-media-'));
  mkdirSync(path.join(mediaDir, ORG_ID), { recursive: true });
  writeFileSync(path.join(mediaDir, ORG_ID, FILE_NAME), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const config = {
    get: vi.fn((key: string) =>
      key === 'MEDIA_DIR' ? mediaDir : key === 'META_GRAPH_VERSION' ? 'v21.0' : undefined,
    ),
  } as unknown as ConfigService<Env, true>;
  controller = new MediaController(new MediaService(config));
});

afterEach(() => {
  rmSync(mediaDir, { recursive: true, force: true });
});

describe('MediaController — serve', () => {
  it('arquivo existente → sendFile com caminho resolvido, Content-Type e cache imutável', async () => {
    const res = createResponse();
    await controller.serve(ORG_ID, FILE_NAME, res);

    expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(
      path.resolve(mediaDir, ORG_ID, FILE_NAME),
      expect.any(Function),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  it('arquivo com formato válido mas inexistente → 404', async () => {
    const res = createResponse();
    const missing = `${randomBytes(16).toString('hex')}.png`;
    await expect(controller.serve(ORG_ID, missing, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it.each([
    ['..', 'file com dot-dot puro'],
    ['../secret.png', 'traversal relativo'],
    ['..\\secret.png', 'traversal com backslash (Windows)'],
    ['%2e%2e%2fsecret.png', 'traversal percent-encoded literal'],
    ['..%2fsecret.png', 'traversal misto literal'],
    [`${'a'.repeat(32)}.png/extra`, 'barra embutida no segmento'],
    ['deadbeef.png', 'nome fora do formato de 128 bits'],
    [`${randomBytes(16).toString('hex')}`, 'sem extensão'],
    [`${randomBytes(16).toString('hex')}.p!g`, 'extensão com caractere inválido'],
    [`${randomBytes(16).toString('hex')}.superlongext`, 'extensão longa demais'],
    ['', 'arquivo vazio'],
  ])('arquivo malicioso/inválido %s (%s) → 400', async (file) => {
    const res = createResponse();
    await expect(controller.serve(ORG_ID, file, res)).rejects.toBeInstanceOf(BadRequestException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it.each([
    ['..', 'dot-dot puro'],
    ['../outra-org', 'traversal relativo'],
    ['%2e%2e', 'percent-encoded literal'],
    ['Org_COM-simbolos', 'caracteres fora de [a-z0-9]'],
    ['abc', 'curto demais para cuid'],
    [`${ORG_ID}/..`, 'barra embutida'],
    ['', 'vazio'],
  ])('orgId malicioso/inválido %s (%s) → 400', async (orgId) => {
    const res = createResponse();
    await expect(controller.serve(orgId, FILE_NAME, res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('nunca serve fora da raiz de mídia mesmo com segmentos válidos', async () => {
    // Arquivo "vizinho" fora de MEDIA_DIR com nomes que passariam na regex:
    // o resolve+prefixo garante que só {mediaRoot}/{orgId}/{file} é servível.
    const outside = path.resolve(mediaDir, '..', `sm-media-outside-${Date.now()}`);
    mkdirSync(path.join(outside, ORG_ID), { recursive: true });
    writeFileSync(path.join(outside, ORG_ID, FILE_NAME), 'segredo');
    try {
      const res = createResponse();
      await controller.serve(ORG_ID, FILE_NAME, res);
      // Servido DE DENTRO da raiz (o arquivo legítimo), nunca o de fora.
      expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(
        path.resolve(mediaDir, ORG_ID, FILE_NAME),
        expect.any(Function),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('MediaController — serveUpload (CONTRACTS §13, path de 3 segmentos)', () => {
  it('arquivo de upload existente → sendFile do caminho {orgId}/uploads/{arquivo}', async () => {
    mkdirSync(path.join(mediaDir, ORG_ID, 'uploads'), { recursive: true });
    writeFileSync(
      path.join(mediaDir, ORG_ID, 'uploads', FILE_NAME),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const res = createResponse();
    await controller.serveUpload(ORG_ID, FILE_NAME, res);

    expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(
      path.resolve(mediaDir, ORG_ID, 'uploads', FILE_NAME),
      expect.any(Function),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
  });

  it('upload inexistente (mas formato válido) → 404', async () => {
    mkdirSync(path.join(mediaDir, ORG_ID, 'uploads'), { recursive: true });
    const res = createResponse();
    const missing = `${randomBytes(16).toString('hex')}.png`;
    await expect(controller.serveUpload(ORG_ID, missing, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('NUNCA cai no arquivo de 2 segmentos com o mesmo nome (uploads é subpasta isolada)', async () => {
    // Mesmo nome de arquivo existe nos DOIS lugares — cada rota só enxerga o seu.
    writeFileSync(path.join(mediaDir, ORG_ID, FILE_NAME), 'nivel-2-segmentos');
    mkdirSync(path.join(mediaDir, ORG_ID, 'uploads'), { recursive: true });
    writeFileSync(path.join(mediaDir, ORG_ID, 'uploads', FILE_NAME), 'nivel-3-segmentos-uploads');

    const res = createResponse();
    await controller.serveUpload(ORG_ID, FILE_NAME, res);
    expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(
      path.resolve(mediaDir, ORG_ID, 'uploads', FILE_NAME),
      expect.any(Function),
    );
  });

  it.each([
    ['..', 'file com dot-dot puro'],
    ['../../secret.png', 'traversal relativo'],
    ['deadbeef.png', 'nome fora do formato de 128 bits'],
  ])('arquivo malicioso/inválido em uploads %s (%s) → 400', async (file) => {
    const res = createResponse();
    await expect(controller.serveUpload(ORG_ID, file, res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('nunca serve fora da raiz de mídia mesmo com segmentos válidos', async () => {
    // Arquivo "vizinho" fora de MEDIA_DIR com nomes que passariam na regex:
    // o resolve+prefixo garante que só {mediaRoot}/{orgId}/{file} é servível.
    const outside = path.resolve(mediaDir, '..', `sm-media-outside-${Date.now()}`);
    mkdirSync(path.join(outside, ORG_ID), { recursive: true });
    writeFileSync(path.join(outside, ORG_ID, FILE_NAME), 'segredo');
    try {
      const res = createResponse();
      await controller.serve(ORG_ID, FILE_NAME, res);
      // Servido DE DENTRO da raiz (o arquivo legítimo), nunca o de fora.
      expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(
        path.resolve(mediaDir, ORG_ID, FILE_NAME),
        expect.any(Function),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
