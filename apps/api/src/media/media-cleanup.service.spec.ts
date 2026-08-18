import 'reflect-metadata';
import { MessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { MediaCleanupService, UPLOAD_ORPHAN_TTL_MS } from './media-cleanup.service';
import type { MediaService, UploadFileEntry } from './media.service';

/**
 * MediaCleanupService (CONTRACTS §13, correção de revisão — high): remove
 * uploads outbound órfãos (mais de 48h e sem nenhuma Message referenciando)
 * SEM tocar nos arquivos ainda referenciados ou ainda dentro do TTL — o
 * vetor de esgotamento de disco descrito na revisão (anexo descartado no
 * client + probing não autenticado de POST /webchat/uploads) só é mitigado se
 * nada legítimo for apagado por engano.
 */

const ORG_ID = 'org-1';
const NOW = Date.now();
const OLD_MTIME = NOW - (UPLOAD_ORPHAN_TTL_MS + 60_000); // um pouco além do TTL
const FRESH_MTIME = NOW - 60_000; // 1 minuto atrás — bem dentro do TTL

function fileEntry(fileName: string, mtimeMs: number, orgId: string = ORG_ID): UploadFileEntry {
  return { fileName, absolutePath: `/media/${orgId}/uploads/${fileName}`, mtimeMs };
}

function buildService(overrides: {
  orgIds?: string[];
  files?: Record<string, UploadFileEntry[]>;
  messages?: Array<{ content: unknown }>;
  findManyImpl?: (args: { where: { orgId: string } }) => Promise<Array<{ content: unknown }>>;
} = {}) {
  const orgIds = overrides.orgIds ?? [ORG_ID];
  const filesByOrg = overrides.files ?? {};
  const deleteUploadFile = vi.fn().mockResolvedValue(undefined);
  const media = {
    listOrgIds: vi.fn().mockResolvedValue(orgIds),
    listOrgUploadFiles: vi.fn((orgId: string) => Promise.resolve(filesByOrg[orgId] ?? [])),
    deleteUploadFile,
  } as unknown as MediaService;

  const findMany = overrides.findManyImpl
    ? vi.fn(overrides.findManyImpl)
    : vi.fn().mockResolvedValue(overrides.messages ?? []);
  const prisma = {
    prismaSystem: { message: { findMany } },
  } as unknown as PrismaService;

  const service = new MediaCleanupService(media, prisma);
  return { service, media, prisma, deleteUploadFile, findMany };
}

describe('MediaCleanupService.run', () => {
  it('org sem arquivos de upload → não consulta o banco e não deleta nada', async () => {
    const { service, findMany, deleteUploadFile } = buildService({ files: { [ORG_ID]: [] } });

    const result = await service.run(NOW);

    expect(findMany).not.toHaveBeenCalled();
    expect(deleteUploadFile).not.toHaveBeenCalled();
    expect(result).toEqual({ scannedOrgs: 1, deletedFiles: 0 });
  });

  it('arquivo dentro do TTL → nunca é removido, mesmo sem referência', async () => {
    const { service, deleteUploadFile } = buildService({
      files: { [ORG_ID]: [fileEntry('fresh.jpg', FRESH_MTIME)] },
      messages: [],
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).not.toHaveBeenCalled();
    expect(result.deletedFiles).toBe(0);
  });

  it('arquivo além do TTL e referenciado por uma Message → preservado', async () => {
    const { service, deleteUploadFile } = buildService({
      files: { [ORG_ID]: [fileEntry('em-uso.jpg', OLD_MTIME)] },
      messages: [
        { content: { mediaUrl: `/api/media/${ORG_ID}/uploads/em-uso.jpg`, mimeType: 'image/jpeg' } },
      ],
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).not.toHaveBeenCalled();
    expect(result.deletedFiles).toBe(0);
  });

  it('arquivo além do TTL e SEM nenhuma Message referenciando → removido (órfão)', async () => {
    const { service, deleteUploadFile } = buildService({
      files: { [ORG_ID]: [fileEntry('orfao.jpg', OLD_MTIME)] },
      messages: [],
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).toHaveBeenCalledExactlyOnceWith(`/media/${ORG_ID}/uploads/orfao.jpg`);
    expect(result.deletedFiles).toBe(1);
  });

  it('mistura: só o órfão além do TTL é removido, os demais preservados', async () => {
    const { service, deleteUploadFile } = buildService({
      files: {
        [ORG_ID]: [
          fileEntry('orfao.jpg', OLD_MTIME),
          fileEntry('fresh.jpg', FRESH_MTIME),
          fileEntry('em-uso.jpg', OLD_MTIME),
        ],
      },
      messages: [
        { content: { mediaUrl: `/api/media/${ORG_ID}/uploads/em-uso.jpg`, mimeType: 'image/jpeg' } },
      ],
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).toHaveBeenCalledExactlyOnceWith(`/media/${ORG_ID}/uploads/orfao.jpg`);
    expect(result).toEqual({ scannedOrgs: 1, deletedFiles: 1 });
  });

  it('varre múltiplas orgs de forma independente', async () => {
    const otherOrg = 'org-2';
    const { service, deleteUploadFile } = buildService({
      orgIds: [ORG_ID, otherOrg],
      files: {
        [ORG_ID]: [fileEntry('a.jpg', OLD_MTIME)],
        [otherOrg]: [fileEntry('b.jpg', OLD_MTIME, otherOrg)],
      },
      messages: [],
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scannedOrgs: 2, deletedFiles: 2 });
  });

  it('mensagens de tipo TEXT/TEMPLATE não entram na consulta de referência (filtro por type)', async () => {
    const { service, findMany } = buildService({ files: { [ORG_ID]: [fileEntry('a.jpg', OLD_MTIME)] } });

    await service.run(NOW);

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        orgId: ORG_ID,
        type: {
          in: [
            MessageType.IMAGE,
            MessageType.AUDIO,
            MessageType.VIDEO,
            MessageType.DOCUMENT,
            MessageType.STICKER,
          ],
        },
      },
      select: { content: true },
    });
  });

  it('erro numa org (findMany rejeita) não interrompe a varredura das demais', async () => {
    const otherOrg = 'org-2';
    const { service, deleteUploadFile } = buildService({
      orgIds: [ORG_ID, otherOrg],
      files: {
        [ORG_ID]: [fileEntry('a.jpg', OLD_MTIME)],
        [otherOrg]: [fileEntry('b.jpg', OLD_MTIME, otherOrg)],
      },
      // findMany falha só para org-1; org-2 segue normalmente.
      findManyImpl: ({ where }) =>
        where.orgId === ORG_ID
          ? Promise.reject(new Error('DB indisponível'))
          : Promise.resolve([]),
    });

    const result = await service.run(NOW);

    expect(deleteUploadFile).toHaveBeenCalledExactlyOnceWith(`/media/${otherOrg}/uploads/b.jpg`);
    expect(result).toEqual({ scannedOrgs: 2, deletedFiles: 1 });
  });
});
