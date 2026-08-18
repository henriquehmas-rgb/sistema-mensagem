import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { createUploadMulterOptions } from '../media/multer-upload.options';
import { MediaService, type StoredUpload } from '../media/media.service';

/**
 * POST /api/v1/uploads (CONTRACTS §13) — multipart/form-data, campo `file`.
 * JWT Bearer via guard global (sem @Public()): tenant-scoped pelo orgId do
 * PRÓPRIO JWT (@CurrentUser), NUNCA por um campo do body/form — um agente não
 * pode gravar upload em outra org. Storage em memória (multer) + validação de
 * mime/tamanho em MediaService.storeUpload.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', createUploadMulterOptions()))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('orgId') orgId: string,
  ): Promise<StoredUpload> {
    if (!file) {
      throw new BadRequestException('Arquivo ausente (campo "file")');
    }
    return this.media.storeUpload(orgId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      originalname: file.originalname,
    });
  }
}
