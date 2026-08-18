import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { MediaService, StoredUpload } from '../media/media.service';
import { UploadsController } from './uploads.controller';

/**
 * POST /api/v1/uploads (CONTRACTS §13) — tenant scoping: o orgId usado para
 * gravar/servir o upload é SEMPRE o do JWT do usuário autenticado
 * (@CurrentUser), nunca algo vindo do multipart/body — um agente não pode
 * escolher gravar em outra organização.
 */

function fakeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'foto.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 4,
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('UploadsController — tenant scoping', () => {
  it('usa o orgId do usuário autenticado (@CurrentUser), não um valor do request', async () => {
    const storeUpload = vi.fn<MediaService['storeUpload']>().mockResolvedValue({
      mediaUrl: '/api/media/org-do-jwt/uploads/abc.jpg',
      mimeType: 'image/jpeg',
      filename: 'foto.jpg',
      sizeBytes: 4,
    } satisfies StoredUpload);
    const media = { storeUpload } as unknown as MediaService;
    const controller = new UploadsController(media);

    const file = fakeFile();
    const result = await controller.upload(file, 'org-do-jwt');

    expect(storeUpload).toHaveBeenCalledExactlyOnceWith('org-do-jwt', {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      originalname: file.originalname,
    });
    expect(result.mediaUrl).toContain('org-do-jwt');
  });

  it('sem arquivo (campo "file" ausente) → 400, sem chamar o storage', async () => {
    const storeUpload = vi.fn<MediaService['storeUpload']>();
    const media = { storeUpload } as unknown as MediaService;
    const controller = new UploadsController(media);

    await expect(controller.upload(undefined, 'org-do-jwt')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storeUpload).not.toHaveBeenCalled();
  });
});
