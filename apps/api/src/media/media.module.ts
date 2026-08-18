import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/**
 * Mídia re-hospedada (CONTRACTS §6): MediaService (fetchAndStore do re-host de
 * mídia inbound da Meta + resolução segura de caminho) e o controller público
 * GET /api/media/:orgId/:file. O processor `webhook-ingest` (WebhooksModule)
 * consome o MediaService.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
