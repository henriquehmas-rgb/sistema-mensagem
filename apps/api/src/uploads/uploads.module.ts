import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { UploadsController } from './uploads.controller';

/**
 * Upload de mídia outbound do agente autenticado (CONTRACTS §13):
 * POST /uploads reaproveita o MediaService (mesma raiz MEDIA_DIR do re-host
 * inbound, subpasta `uploads/`).
 */
@Module({
  imports: [MediaModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
